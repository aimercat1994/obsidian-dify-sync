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

    containerEl.createEl('h2', { text: 'Dify 同步设置' });

    new Setting(containerEl)
      .setName('Dify API 端点')
      .setDesc('Dify 服务的基础地址，例如 http://192.168.1.10:1180/v1')
      .addText(text => text
        .setPlaceholder('http://localhost/v1')
        .setValue(this.plugin.settings.endpoint)
        .onChange(async (value) => {
          this.plugin.settings.endpoint = value.replace(/\/+$/, '');
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('知识库 API Key')
      .setDesc('在 Dify → 知识库 → Service API → API Key 中创建')
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
      .setName('知识库 ID')
      .setDesc('Dify 知识库 URL 中的 UUID')
      .addText(text => text
        .setPlaceholder('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx')
        .setValue(this.plugin.settings.datasetId)
        .onChange(async (value) => {
          this.plugin.settings.datasetId = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('同步文件夹')
      .setDesc('Vault 中要同步的文件夹路径。"/" 表示整个 vault，"笔记/" 表示仅该子目录')
      .addText(text => text
        .setPlaceholder('/')
        .setValue(this.plugin.settings.syncFolder)
        .onChange(async (value) => {
          this.plugin.settings.syncFolder = value || '/';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('文档语言')
      .setDesc('用于 Dify 分词处理优化')
      .addDropdown(dropdown => dropdown
        .addOption('Chinese', '中文')
        .addOption('English', '英文')
        .addOption('Japanese', '日文')
        .setValue(this.plugin.settings.docLanguage)
        .onChange(async (value) => {
          this.plugin.settings.docLanguage = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('自动同步')
      .setDesc('文件新增、修改、删除时自动同步到 Dify')
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

    new Setting(containerEl)
      .setName('冲突处理')
      .setDesc('当 Dify 端文档被外部修改时如何处理。全量同步始终以 Obsidian 为准')
      .addDropdown(dropdown => dropdown
        .addOption('overwrite', '覆盖 Dify（Obsidian 优先）')
        .addOption('keep_dify', '保留 Dify 修改（跳过冲突文档）')
        .setValue(this.plugin.settings.conflictStrategy)
        .onChange(async (value) => {
          this.plugin.settings.conflictStrategy = value as 'overwrite' | 'keep_dify';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('标签过滤')
      .setDesc('只同步包含指定标签的笔记。多个标签用逗号分隔（需同时满足），留空=不过滤。例如 "dify,public"')
      .addText(text => text
        .setPlaceholder('dify')
        .setValue(this.plugin.settings.filterTags)
        .onChange(async (value) => {
          this.plugin.settings.filterTags = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('最大并发数')
      .setDesc('同时发往 Dify 的 API 请求数。提高可加速大量同步，但太高可能触发限流。推荐 3-5')
      .addSlider(slider => slider
        .setLimits(1, 10, 1)
        .setValue(this.plugin.settings.maxConcurrency)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.maxConcurrency = value;
          await this.plugin.saveSettings();
        }));

    containerEl.createEl('h3', { text: '操作' });

    new Setting(containerEl)
      .setName('全量同步')
      .setDesc('将同步文件夹中的所有笔记推送到 Dify，并清理 Dify 端多余文档')
      .addButton(button => button
        .setButtonText('立即同步')
        .onClick(async () => {
          button.setDisabled(true);
          button.setButtonText('同步中…');
          await this.plugin.syncEngine.fullSync();
          button.setButtonText('立即同步');
          button.setDisabled(false);
        }));
  }
}
