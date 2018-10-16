'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// The module 'sqlops' contains the SQL Operations Studio extensibility API
// This is a complementary set of APIs that add SQL / Data-specific functionality to the app
// Import the module and reference it with the alias sqlops in your code below

import * as sqlops from 'sqlops';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // The command has been defined in the package.json file
// Now provide the implementation of the command with  registerCommand
// The commandId parameter must match the command field in package.json
    context.subscriptions.push(vscode.commands.registerCommand('extension.scriptObjects', async () => {
        let connection = await sqlops.connection.getCurrentConnection();
        let wizard = new ScriptWizard(connection);
        wizard.open();
    }));
}

// this method is called when your extension is deactivated
export function deactivate() {
}

class ScriptWizard {
    private objectType: string;
    private selectedObjectLabel: string;
    private scriptType: string;
    private scriptTypeDropdown: sqlops.DropDownComponent | undefined;
    private wizard: sqlops.window.modelviewdialog.Wizard;
    private page1: sqlops.window.modelviewdialog.WizardPage;
    private page2: sqlops.window.modelviewdialog.WizardPage;
    private objectMetadataMap = new Map<string, sqlops.ObjectMetadata>();
    static scriptOperations = new Map<string, sqlops.ScriptOperation>([
        ['Select', sqlops.ScriptOperation.Select],
        ['Create', sqlops.ScriptOperation.Create],
        ['Insert', sqlops.ScriptOperation.Insert],
        ['Update', sqlops.ScriptOperation.Update],
        ['Delete', sqlops.ScriptOperation.Delete],
        ['Execute', sqlops.ScriptOperation.Execute],
        ['Alter', sqlops.ScriptOperation.Alter]
    ]);
    static scriptOperationsByType = new Map<string, string[]>([
        ['Table', ['Create', 'Delete']],
        ['View', ['Create', 'Select', 'Alter', 'Delete']],
        ['StoredProcedure', ['Create', 'Execute', 'Alter', 'Delete']]
    ]);

    constructor(private connection: sqlops.connection.Connection) {
        this.objectType = '';
        this.selectedObjectLabel = '';
        this.scriptType = '';
        this.scriptTypeDropdown = undefined;
        this.page1 = this.setupPage1();
        this.page2 = this.setupPage2();
        this.wizard = this.setupWizard(); 
    }

    public open(): void {
        this.wizard.open();
    }

    private setupPage1(): sqlops.window.modelviewdialog.WizardPage {
        let page1 = sqlops.window.modelviewdialog.createWizardPage('Select object');
        page1.registerContent(async view => {
            let typeSelection = view.modelBuilder.dropDown().withValidation(component => component.value !== '').component();
            let objectDropdown = view.modelBuilder.listBox().component();
    
            typeSelection.values = ['', 'Table', 'View', 'StoredProcedure'];
            typeSelection.onValueChanged(value => {
                this.objectType = value.selected;
                this.fillInObjectChoices(objectDropdown);
            });
    
            objectDropdown.onRowSelected(() => {
                this.selectedObjectLabel = objectDropdown.values[objectDropdown.selectedRow || 0];
            });
    
            let flexView = view.modelBuilder.formContainer().withFormItems([
                {
                    component: typeSelection,
                    title: 'Type'
                },
                {
                    component: objectDropdown,
                    title: 'Object to script'
                }
            ]).component();
    
            return view.initializeModel(flexView);
        });
    
        return page1;
    }

    private async fillInObjectChoices(objectDropdown: sqlops.ListBoxComponent): Promise<void> {
        this.objectMetadataMap.clear();
        let metadataProvider = sqlops.dataprotocol.getProvider<sqlops.MetadataProvider>(this.connection.providerName, sqlops.DataProviderType.MetadataProvider);
        let objectMetadata = (await metadataProvider.getMetadata(await sqlops.connection.getUriForConnection(this.connection.connectionId))).objectMetadata;
        let matchingObjects: string[] = [];
        objectMetadata.forEach(metadata => {
            if (metadata.metadataTypeName === this.objectType) {
                let objectLabel = (metadata.schema ? `${metadata.schema}.` : '') + metadata.name;
                matchingObjects.push(objectLabel);
                this.objectMetadataMap.set(objectLabel, metadata);
            }
        });
        objectDropdown.values = matchingObjects;
        if (this.scriptTypeDropdown && this.objectType) {
            this.scriptTypeDropdown.values = ScriptWizard.scriptOperationsByType.get(this.objectType) as string[];
        }
    }

    private setupPage2(): sqlops.window.modelviewdialog.WizardPage {
        let page2 = sqlops.window.modelviewdialog.createWizardPage('Details');
        page2.registerContent(async view => {
            let scriptTypeDropdown = view.modelBuilder.dropDown().component();
            
            scriptTypeDropdown.values = [];
            ScriptWizard.scriptOperations.forEach((_, key) => {
                (scriptTypeDropdown.values as string[]).push(key);
            });
            scriptTypeDropdown.onValueChanged(value => this.scriptType = value.selected);
            let formContainer = view.modelBuilder.formContainer().withFormItems([
                {
                    component: scriptTypeDropdown,
                    title: 'Operation'
                }
            ]).component();
            this.scriptTypeDropdown = scriptTypeDropdown;
            return view.initializeModel(formContainer);
        });
        
        return page2;
    }

    private setupWizard(): sqlops.window.modelviewdialog.Wizard {
        this.wizard = sqlops.window.modelviewdialog.createWizard('Script Wizard');
        this.wizard.pages = [this.page1, this.page2];
        this.wizard.generateScriptButton.hidden = true;
        this.wizard.doneButton.onClick(async () => {
            let scriptingProvider = sqlops.dataprotocol.getProvider<sqlops.ScriptingProvider>(this.connection.providerName, sqlops.DataProviderType.ScriptingProvider);
            let chosenObject = this.objectMetadataMap.get(this.selectedObjectLabel);
            if (chosenObject && this.objectType) {
                let result = await scriptingProvider.scriptAsOperation(await sqlops.connection.getUriForConnection(this.connection.connectionId), ScriptWizard.scriptOperations.get(this.scriptType) as sqlops.ScriptOperation, chosenObject, {
                    filePath: '',
                    scriptCompatibilityOption: 'Script140Compat',
                    targetDatabaseEngineEdition: 'SqlServerStandardEdition',
                    targetDatabaseEngineType: 'SingleInstance'
                });
                if (result.script) {
                    let document = await vscode.workspace.openTextDocument({
                        language: 'sql',
                        content: result.script
                    });
                    vscode.window.showTextDocument(document);
                }
            }
        });
        return this.wizard;
    }
}