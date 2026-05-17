import { App, PluginSettingTab, Setting } from 'obsidian';
import type DifySyncPlugin from './main';

export class DifySyncSettingTab extends PluginSettingTab {
  plugin: DifySyncPlugin;

  constructor(app: App, plugin: DifySyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Dify Sync Settings' });

    new Setting(containerEl)
      .setName('Dify API Endpoint')
      .setDesc('Your Dify instance base URL, e.g. http://192.168.1.10:1180/v1')
      .addText(text => text
        .setPlaceholder('http://localhost:5001/v1')
        .setValue(this.plugin.settings.endpoint)
        .onChange(async (value) => {
          this.plugin.settings.endpoint = value.replace(/\/+$/, '');
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Knowledge Base API Key')
      .setDesc('From Dify → Knowledge → Service API → API Key')
      .addText(text => {
        text.setPlaceholder('dataset-xxxxxxxxxxxx')
          .setValue(this.plugin.settings.apiKey);
        text.inputEl.type = 'password';
        text.onChange(async (value) => {
          this.plugin.settings.apiKey = value;
          await this.plugin.saveSettings();
        });
        return text;
      });

    new Setting(containerEl)
      .setName('Knowledge Base ID')
      .setDesc('The dataset ID from Dify knowledge base URL')
      .addText(text => text
        .setPlaceholder('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx')
        .setValue(this.plugin.settings.datasetId)
        .onChange(async (value) => {
          this.plugin.settings.datasetId = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Sync Folder')
      .setDesc('Vault folder to sync. Use "/" for entire vault, or e.g. "notes/" for a subfolder.')
      .addText(text => text
        .setPlaceholder('/')
        .setValue(this.plugin.settings.syncFolder)
        .onChange(async (value) => {
          this.plugin.settings.syncFolder = value || '/';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Document Language')
      .setDesc('Language hint for Dify processing optimization')
      .addDropdown(dropdown => dropdown
        .addOption('Chinese', 'Chinese')
        .addOption('English', 'English')
        .addOption('Japanese', 'Japanese')
        .setValue(this.plugin.settings.docLanguage)
        .onChange(async (value) => {
          this.plugin.settings.docLanguage = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Auto Sync')
      .setDesc('Automatically sync changes when files are created, modified, or deleted.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoSync)
        .onChange(async (value) => {
          this.plugin.settings.autoSync = value;
          await this.plugin.saveSettings();
          if (value) {
            this.plugin.startAutoSync();
          } else {
            this.plugin.stopAutoSync();
          }
        }));

    containerEl.createEl('h3', { text: 'Actions' });

    new Setting(containerEl)
      .setName('Full Sync')
      .setDesc('Sync all documents in the configured folder to Dify (one-time).')
      .addButton(button => button
        .setButtonText('Sync Now')
        .onClick(async () => {
          button.setDisabled(true);
          button.setButtonText('Syncing...');
          await this.plugin.syncEngine.fullSync();
          button.setButtonText('Sync Now');
          button.setDisabled(false);
        }));
  }
}
