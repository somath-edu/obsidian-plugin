/* main.js */
const obsidian = require('obsidian');

const DEFAULT_SETTINGS = {
    geminiApiKey: '',
    groqApiKey: '',
    defaultModel: 'gemini'
};

class AICumulativePlugin extends obsidian.Plugin {
    async onload() {
        await this.loadSettings();

        // 1. 리본 아이콘 (왼쪽 사이드바)
        this.addRibbonIcon('bot', 'AI 직독직해 열기', () => {
            new AIInputModal(this.app, this).open();
        });

        // 2. 명령어 (모바일 툴바용)
        this.addCommand({
            id: 'open-ai-cumulative-modal',
            name: 'AI 직독직해 생성기 열기',
            callback: () => {
                new AIInputModal(this.app, this).open();
            }
        });

        // 3. 설정 탭
        this.addSettingTab(new AISettingTab(this.app, this));
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class AIInputModal extends obsidian.Modal {
    constructor(app, plugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: "영어 기사 변환기 (Gemini & Groq)" });

        // 모델 선택 드롭다운
        const modelSelectDiv = contentEl.createDiv();
        modelSelectDiv.style.marginBottom = "10px";
        modelSelectDiv.createSpan({ text: "사용할 모델: " });
        
        const modelSelect = modelSelectDiv.createEl("select");
        modelSelect.style.marginLeft = "10px";
        
        // [수정됨] 모델명 표시 텍스트 수정
        const optionGemini = modelSelect.createEl("option", { text: "Google Gemini 1.5 Flash", value: "gemini" });
        const optionGroq = modelSelect.createEl("option", { text: "Groq (Llama 3.3 70b)", value: "groq" });

        // 기본값 설정
        modelSelect.value = this.plugin.settings.defaultModel;

        // 입력창
        const inputArea = contentEl.createEl("textarea", {
            attr: {
                placeholder: "영어 기사를 여기에 붙여넣으세요...",
                style: "width: 100%; height: 250px; font-size: 16px; margin-bottom: 15px; padding: 10px;"
            }
        });

        // 실행 버튼
        const submitBtn = contentEl.createEl("button", { text: "변환 시작" });
        submitBtn.style.cssText = "background-color: var(--interactive-accent); color: white; width: 100%; padding: 12px; font-weight: bold;";

        submitBtn.onclick = async () => {
            const selectedModel = modelSelect.value;
            const text = inputArea.value;

            if (!text) {
                new obsidian.Notice("내용을 입력해주세요!");
                return;
            }

            // API 키 확인 (공백 제거 후 확인)
            if (selectedModel === 'gemini' && !this.plugin.settings.geminiApiKey.trim()) {
                new obsidian.Notice("설정에서 Gemini API 키를 입력해주세요!");
                return;
            }
            if (selectedModel === 'groq' && !this.plugin.settings.groqApiKey.trim()) {
                new obsidian.Notice("설정에서 Groq API 키를 입력해주세요!");
                return;
            }

            submitBtn.setText("AI가 생각 중입니다... (" + selectedModel + ")");
            submitBtn.setAttr("disabled", "true");

            try {
                let result = "";
                if (selectedModel === 'gemini') {
                    result = await this.callGemini(text);
                } else {
                    result = await this.callGroq(text);
                }

                this.insertToEditor(result);
                this.close();
                new obsidian.Notice("변환 완료!");
            } catch (error) {
                console.error(error);
                new obsidian.Notice("에러 발생: " + error.message);
                submitBtn.setText("다시 시도");
                submitBtn.removeAttribute("disabled");
            }
        };
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }

    insertToEditor(text) {
        const view = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        if (view) {
            const cursor = view.editor.getCursor();
            view.editor.replaceRange(text, cursor);
        }
    }

    // --- Gemini 호출 ---
    async callGemini(text) {
        const prompt = this.getPrompt(text);
        // [수정됨] API 키 뒤에 .trim()을 붙여서 공백 제거
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.plugin.settings.geminiApiKey.trim()}`;
        
        const response = await obsidian.requestUrl({
            url: url,
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        if (response.status !== 200) {
            throw new Error(`Gemini Error: ${response.status}`);
        }

        return response.json.candidates[0].content.parts[0].text;
    }

    // --- Groq (Llama3) 호출 ---
    async callGroq(text) {
        const prompt = this.getPrompt(text);
        const url = "https://api.groq.com/openai/v1/chat/completions";

        const response = await obsidian.requestUrl({
            url: url,
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                // [수정됨] API 키 뒤에 .trim()을 붙여서 공백 제거
                "Authorization": `Bearer ${this.plugin.settings.groqApiKey.trim()}`
            },
            body: JSON.stringify({
                // [수정됨] 구버전 모델명을 최신 Llama 3.3 Versatile로 변경 (에러 해결 핵심)
                model: "llama-3.3-70b-versatile",
                messages: [{ role: "user", content: prompt }]
            })
        });

        if (response.status !== 200) {
             // 에러 상세 내용을 보기 위해 로그 추가
            console.log(response);
            throw new Error(`Groq Error: ${response.status}`);
        }

        return response.json.choices[0].message.content;
    }

    getPrompt(text) {
        return `
        Role: Expert English Tutor.
        Task: Convert the input text into "Cumulative Reading" format.
        
        Rules:
        1. Break sentences into meaningful chunks (sense groups).
        2. Show the chunks cumulatively line by line.
        3. End each cumulative line with a slash (/).
        4. After the full sentence is complete, add a blank line and then provide a natural Korean translation.
        5. Separate distinct original sentences with "---".

        Input: "${text}"
        `;
    }
}

class AISettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'AI 모델 설정' });

        new obsidian.Setting(containerEl)
            .setName('Gemini API Key')
            .setDesc('Google AI Studio 키')
            .addText(text => text
                .setPlaceholder('Enter Gemini Key')
                .setValue(this.plugin.settings.geminiApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.geminiApiKey = value;
                    await this.plugin.saveSettings();
                }));

        new obsidian.Setting(containerEl)
            .setName('Groq API Key')
            .setDesc('Groq Console 키 (Llama 3 70b 사용)')
            .addText(text => text
                .setPlaceholder('Enter Groq Key')
                .setValue(this.plugin.settings.groqApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.groqApiKey = value;
                    await this.plugin.saveSettings();
                }));
        
        new obsidian.Setting(containerEl)
            .setName('기본 모델')
            .setDesc('처음 팝업을 열었을 때 선택되어 있을 모델')
            .addDropdown(dropdown => dropdown
                .addOption('gemini', 'Gemini 1.5 Flash')
                .addOption('groq', 'Groq Llama 3')
                .setValue(this.plugin.settings.defaultModel)
                .onChange(async (value) => {
                    this.plugin.settings.defaultModel = value;
                    await this.plugin.saveSettings();
                }));
    }
}

module.exports = AICumulativePlugin;
