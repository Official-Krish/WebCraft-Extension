// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { WebSocket } from 'ws';
import * as path from 'path';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log('WebCraft extension is now active!');
	
	let ws = initWS(context);

	ws.onerror = (error) => {
		console.log("Error connecting to WS, reconnecting...", error);
		ws = initWS(context);
	};


	const aiTerminal = vscode.window.createTerminal({
		name: "AI Terminal",
		hideFromUser: false,
	});

	context.globalState.update("aiTerminalId", aiTerminal.processId);
	aiTerminal.show();
	vscode.commands.executeCommand('workbench.action.terminal.focus');

	let sendToAiTerminal = vscode.commands.registerCommand('extension.sendToAiTerminal', async (text) => {
		console.log(`Sending to AI Terminal: ${text}`);
		
		const terminalId = context.globalState.get('aiTerminalId');
		const terminals = vscode.window.terminals;
		let aiTerm = terminals.find(t => t.processId === terminalId);
		
		if (!aiTerm) {
			console.log('AI Terminal not found, creating new one...');
			vscode.window.showErrorMessage('AI Terminal not found. Creating a new one.');
			
			aiTerm = vscode.window.createTerminal({
				name: "AI Terminal",
				hideFromUser: false
			});
			context.globalState.update('aiTerminalId', aiTerm.processId);
			aiTerm.show();
		}
		
		// Send the text to the terminal
		aiTerm.sendText(text);
	});

	context.subscriptions.push(sendToAiTerminal);

	// Register the hello world command
	const disposable = vscode.commands.registerCommand('webCraft-listener.helloWorld', () => {
		console.log('Hello World command executed!');
		vscode.window.showInformationMessage('Hello World from webCraft-listener!');
		
		// Create a new terminal for build commands (separate from AI Terminal)
		const buildTerminal = vscode.window.createTerminal({
			name: "Build Terminal"
		});
		buildTerminal.show();
		buildTerminal.sendText("npm run build");
	});

	context.subscriptions.push(disposable);

	// Handle terminal closure to clean up stored IDs
	const terminalCloseListener = vscode.window.onDidCloseTerminal((terminal) => {
		const storedId = context.globalState.get('aiTerminalId');
		if (terminal.processId === storedId) {
			console.log('AI Terminal was closed, clearing stored ID');
			context.globalState.update('aiTerminalId', undefined);
		}
	});

	context.subscriptions.push(terminalCloseListener);
}

// This method is called when your extension is deactivated
export function deactivate() {
	console.log('WebCraft extension is deactivated');
}

function initWS(context: vscode.ExtensionContext): WebSocket {
	const wsUrl = process.env.WS_RELAYER_URL || "ws://localhost:9093";
	console.log(`Connecting to WebSocket: ${wsUrl}`);
	
	const ws = new WebSocket(wsUrl);

	ws.onopen = () => {
		console.log('WebSocket connected successfully');
		ws.send(JSON.stringify({
			event: "subscribe",
			data: null
		}));
	};

	ws.onclose = () => {
		console.log('WebSocket connection closed');
	};

	ws.onerror = (error) => {
		console.error('WebSocket error:', error);
	};

	ws.onmessage = async (event: any) => {
		try {
			const data: any = JSON.parse(event.data);
			console.log('Received WebSocket message:', data);

			if (data.type === "command") {
				console.log('Executing command:', data.content);
				vscode.commands.executeCommand('extension.sendToAiTerminal', data.content);
			}

			if (data.type === "update-file") {
				console.log('Updating file:', data.path);
				try {
					const fileUri = await ensureFileExists(data.path, data.content);
					const doc = await vscode.workspace.openTextDocument(fileUri);
					await vscode.window.showTextDocument(doc);

					const edit = new vscode.WorkspaceEdit();
					const range = new vscode.Range(
						new vscode.Position(0, 0),
						new vscode.Position(doc.lineCount, 0)
					);

					edit.replace(doc.uri, range, data.content);
					await vscode.workspace.applyEdit(edit);
					console.log('File updated successfully');
				} catch (error) {
					console.error('Error updating file:', error);
					vscode.window.showErrorMessage(`Failed to update file: ${error}`);
				}
			}

			if (data.type === "prompt-start") {
				console.log('Prompt start received');
				const terminals = vscode.window.terminals;
				if (terminals.length > 0) {
					const activeTerminal = vscode.window.activeTerminal;
					// Send Ctrl+C to interrupt current process
					activeTerminal?.sendText('\u0003'); // Fixed: was '0x3', should be '\u0003'
				}
			}

			if (data.type === "prompt-end") {
				console.log('Prompt end received, starting dev server');
				vscode.commands.executeCommand('extension.sendToAiTerminal', 'npm run dev');
			}
		} catch (error) {
			console.error('Error processing WebSocket message:', error);
		}
	};

	return ws;
}

async function ensureFileExists(filePath: string, fileContent: string = ''): Promise<vscode.Uri> {
	try {
		const uri = vscode.Uri.file(filePath);
		const dirPath = path.dirname(filePath);

		// Ensure directory exists
		try {
			await vscode.workspace.fs.stat(vscode.Uri.file(dirPath));
		} catch {
			console.log(`Creating directory: ${dirPath}`);
			await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
		}

		// Create file if it doesn't exist
		try {
			await vscode.workspace.fs.stat(uri);
			console.log(`File already exists: ${filePath}`);
		} catch {
			console.log(`Creating file: ${filePath}`);
			await vscode.workspace.fs.writeFile(uri, Buffer.from(fileContent, 'utf8'));
		}

		return uri;
	} catch (e) {
		console.error("Error ensuring file exists:", e);
		vscode.window.showErrorMessage(`Error ensuring file exists: ${e}`);
		throw e;
	}
}