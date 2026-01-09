// Keyword Generator (startup-stable) — Gemini + ChatGPT
// Zotero plugin bootstrap (Zotero 6/7 chrome context)

const { interfaces: Ci } = Components;

var KeywordGenerator = {
  id: "keyword-generator@sudhirvr23.com",
  version: "2.0.4-startup-stable",
  rootURI: null,
  initialized: false,
  windows: new Set(),

  // ---- Config (safe defaults; real values loaded in startup via prefs) ----
  cfg: {
    geminiApiKey: "",
    openaiApiKey: "",
    provider: "gemini",            // "gemini" | "chatgpt"
    geminiModel: "gemini-2.5-flash",
    chatgptModel: "gpt-4o-mini",
    maxKeywords: 10,
    PAUSE_MS: 900,
    CAP_CHARS: 1700,
    DEBUG: false,
    tagTarget: "both"              // "attachment" | "parent" | "both"
  },

  // ==== Utils ====
  log(msg) { if (this.cfg.DEBUG) Zotero.debug("[KG] " + msg); },
  toast(text, title = "Keyword Generator") {
    try {
      const pw = new Zotero.ProgressWindow(); pw.changeHeadline(title); pw.addDescription(text); pw.show(); pw.startCloseTimer(4000);
    } catch (e) { Zotero.debug("[KG toast] " + e); }
  },

  xul(doc, tag) {
    return (doc.createXULElement ? doc.createXULElement(tag)
      : doc.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', tag));
  },

  promptString(title, message, preset = "") {
    try {
      const out = { value: preset };
      const ok = Services.prompt.prompt(null, title, message, out, null, {});
      return ok ? (out.value || "").trim() : null;
    } catch {
      try { return (Zotero.getMainWindow().prompt(message, preset) || "").trim(); }
      catch { return preset; }
    }
  },

  setPref(key, val) { try { Zotero.Prefs.set(key, val); } catch (e) { this.log("Pref set failed: " + e); } },
  getPref(key, fallback = "") { try { const v = Zotero.Prefs.get(key); return (v === null || v === undefined) ? fallback : v; } catch { return fallback; } },

  // Canonical form for de-dupe (treats hyphen/space variants as equal)
  canon(s) {
    return String(s || "").toLowerCase()
      .replace(/[–—]/g, "-")
      .replace(/[-_]+/g, " ")
      .replace(/[^\p{L}\p{N} ]+/gu, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  },

  // ==== Prefs (loaded only after Zotero is ready) ====
  loadPrefs() {
    this.cfg.geminiApiKey = this.getPref("extensions.keywordGenerator.geminiApiKey", this.cfg.geminiApiKey);
    this.cfg.openaiApiKey = this.getPref("extensions.keywordGenerator.openaiApiKey", this.cfg.openaiApiKey);
    this.cfg.provider = this.getPref("extensions.keywordGenerator.selectedProvider", this.cfg.provider);
    this.cfg.geminiModel = this.getPref("extensions.keywordGenerator.geminiModelName", this.cfg.geminiModel);
    this.cfg.chatgptModel = this.getPref("extensions.keywordGenerator.chatgptModel", this.cfg.chatgptModel);
    this.cfg.maxKeywords = parseInt(this.getPref("extensions.keywordGenerator.maxKeywords", this.cfg.maxKeywords), 10) || 10;
    this.cfg.PAUSE_MS = parseInt(this.getPref("extensions.keywordGenerator.pauseMs", this.cfg.PAUSE_MS), 10) || 900;
    this.cfg.CAP_CHARS = parseInt(this.getPref("extensions.keywordGenerator.capChars", this.cfg.CAP_CHARS), 10) || 1700;
    this.cfg.DEBUG = !!this.getPref("extensions.keywordGenerator.debug", this.cfg.DEBUG);
    this.cfg.tagTarget = this.getPref("extensions.keywordGenerator.tagTarget", this.cfg.tagTarget);
  },

  // ==== Provider setup / selection ====
  setupApiKey(win = null, explicitProvider = null) {
    const prov = explicitProvider || ((win || Zotero.getMainWindow()).confirm(
      "Which AI provider do you want to configure?\n\nOK = Gemini (Google)\nCancel = ChatGPT (OpenAI)") ? "gemini" : "chatgpt"
    );

    const isGem = prov === "gemini";
    const prefKey = isGem ? "extensions.keywordGenerator.geminiApiKey" : "extensions.keywordGenerator.openaiApiKey";
    const current = this.getPref(prefKey, "");
    const title = isGem ? "Gemini API Key" : "OpenAI API Key";
    const steps = isGem
      ? "1) https://aistudio.google.com/app/apikey\n2) Create key\n3) Paste below:"
      : "1) https://platform.openai.com/api-keys\n2) Create key\n3) Paste below:";
    const res = this.promptString(title, `Enter your ${title}\n\n${steps}`, current);
    if (res === null) return;

    const apiKey = res.trim();
    if (isGem) {
      if (!apiKey || (!apiKey.startsWith("AI") && !/^[A-Za-z0-9_-]{20,}$/.test(apiKey)))
        return void this.toast("Key format doesn’t look right for Gemini.", "Invalid API Key");
      this.cfg.geminiApiKey = apiKey; this.setPref(prefKey, apiKey);
    } else {
      if (!apiKey || !apiKey.startsWith("sk-") || apiKey.length < 40)
        return void this.toast("OpenAI keys should start with 'sk-'.", "Invalid API Key");
      this.cfg.openaiApiKey = apiKey; this.setPref(prefKey, apiKey);
    }
    this.toast(`API key saved for ${isGem ? "Gemini" : "ChatGPT"}.`);
  },

  selectProvider(win = null) {
    const hasGem = this.cfg.geminiApiKey ? "✅" : "❌";
    const hasOAI = this.cfg.openaiApiKey ? "✅" : "❌";
    const msg = `Select AI Provider for Keyword Generation:

Current: ${this.cfg.provider === "gemini" ? "Gemini" : "ChatGPT"}

${hasGem} Gemini (Google)
${hasOAI} ChatGPT (OpenAI)

OK = Gemini | Cancel = ChatGPT`;
    const useGem = (win || Zotero.getMainWindow()).confirm(msg);
    this.cfg.provider = useGem ? "gemini" : "chatgpt";
    this.setPref("extensions.keywordGenerator.selectedProvider", this.cfg.provider);

    if (this.cfg.provider === "gemini" && !this.cfg.geminiApiKey) this.setupApiKey(win, "gemini");
    if (this.cfg.provider === "chatgpt" && !this.cfg.openaiApiKey) this.setupApiKey(win, "chatgpt");
    this.toast(`Using ${this.cfg.provider === "gemini" ? "Gemini" : "ChatGPT"} for keyword generation.`);
    for (const w of this.windows) this.updateMenuLabel(w);
  },

  // ==== Extraction ====
  isValidTopLevel(item) {
    if (item.isAttachment()) return false;
    const ok = ['journalArticle', 'book', 'bookSection', 'conferencePaper', 'thesis', 'report', 'document', 'webpage'];
    try { return ok.includes(Zotero.ItemTypes.getName(item.itemTypeID)); } catch { return false; }
  },

  listPDFAttachments(selected) {
    const pdfs = [];
    for (const it of selected) {
      if (it.isAttachment()) {
        if (it.attachmentContentType === 'application/pdf' || (it.attachmentFilename || "").toLowerCase().endsWith(".pdf"))
          pdfs.push({ attachment: it, parent: it.parentItem || null });
      } else if (this.isValidTopLevel(it)) {
        const ids = it.getAttachments();
        for (const id of ids) {
          const a = Zotero.Items.get(id);
          if (a && a.attachmentContentType === 'application/pdf') pdfs.push({ attachment: a, parent: it });
        }
      }
    }
    return pdfs;
  },

  textFromMetadata(parent) {
    if (!parent) return "";
    const title = parent.getField('title') || "";
    const creators = (parent.getCreators() || []).slice(0, 3)
      .map(c => [c.firstName || "", c.lastName || ""].join(" ").trim())
      .filter(Boolean);
    const journal = parent.getField('publicationTitle') || parent.getField('publisher') || "";
    const year = parent.getField('date') || "";
    const doi = parent.getField('DOI') || "";
    const abs = (parent.getField('abstractNote') || "").replace(/\s+/g, " ").trim();

    let s = "";
    if (title) s += `Title: ${title}\n`;
    if (creators.length) s += `Authors: ${creators.join(", ")}\n`;
    if (journal || year) s += `Source: ${[journal, year].filter(Boolean).join(", ")}\n`;
    if (doi) s += `DOI: ${doi}\n`;
    if (abs) s += `\nAbstract: ${abs}\n`;

    if (s.length > this.cfg.CAP_CHARS) s = s.slice(0, this.cfg.CAP_CHARS) + "...";
    return s;
  },

  async textFromFulltext(attachment) {
    const tables = ['fulltextItems', 'itemFulltext', 'fulltext'];
    for (const t of tables) {
      try {
        const content = await Zotero.DB.valueQueryAsync(`SELECT content FROM ${t} WHERE itemID = ?`, [attachment.id]);
        if (content && content.length > 60) {
          let tx = content.replace(/\s+/g, ' ').replace(/[^\w\s.,;:!?()\-]/g, ' ').trim();
          if (tx.length > this.cfg.CAP_CHARS) tx = tx.slice(0, this.cfg.CAP_CHARS) + "...";
          return tx;
        }
      } catch {/* noop */ }
    }
    return "";
  },

  async extractContent(attachment) {
    const parent = attachment.parentItem || null;
    const meta = this.textFromMetadata(parent);
    if (meta && meta.length > 60) return meta;

    const ft = await this.textFromFulltext(attachment);
    if (ft && ft.length > 60) return ft;

    let s = `Attachment: ${attachment.getDisplayTitle()}\n`;
    const fn = attachment.attachmentFilename || "";
    if (fn) s += `Filename: ${fn}\n`;
    if (parent) {
      const pTitle = parent.getField('title') || "";
      if (pTitle) s += `Parent Title: ${pTitle}\n`;
    }
    return s;
  },

  // ==== LLM prompt & call ====
  buildPrompt(content, n, existing = []) {
    const guard = existing.length
      ? `\nDo NOT repeat any of these existing tags: ${existing.join(", ")}`
      : "";
    //return `You are an expert academic librarian. Generate exactly ${n} concise, high-value keywords for academic search.
    return `I will give you a research article reference (DOI, PubMed ID, or title). Your task is to generate ${n} concise high-quality, publication-style keywords that reflect the article key themes, methodology, population, intervention, outcomes, and clinical/academic significance.
The keywords should include: Core topic / disease / intervention, Study design or methodology, Population characteristics (e.g., age group, region, sample type),
Primary outcomes or risk factors studied, Specific diseases, biomarkers, or subtypes mentioned, Clinical or translational implications.
Provide them in a clean, list. If available, base them on the abstract and results of the article, not just the title.

PAPER INFORMATION:
${content}

Rules:
- Exactly ${n} keywords
- 1–3 words each
- Mix domain terms, specific technical terms, and methods
- Useful for academic search and categorization${guard}
- Return ONLY the keywords separated by commas`;
  },

  parseKeywords(raw, maxN) {
    if (!raw) return [];
    const parts = raw
      .replace(/[\u2022\u2023\u25E6\u2043\-–—]\s*/g, "") // bullets/dashes
      .replace(/\n+/g, ",")
      .split(",")
      .map(s => s.trim().replace(/^["'`]|["'`]$/g, ""))
      .filter(Boolean)
      .map(s => s.replace(/\s{2,}/g, " "))
      .filter(s => s.length <= 50 && s.split(/\s+/).length <= 4);

    const seen = new Set(), out = [];
    for (const k of parts) {
      const key = this.canon(k);
      if (!key) continue;
      if (!seen.has(key)) { seen.add(key); out.push(k); }
      if (out.length === maxN) break;
    }
    return out;
  },

  async sendToLLM(provider, content, existingTags = []) {
    const n = this.cfg.maxKeywords;
    const prompt = this.buildPrompt(content, n, existingTags);

    if (provider === "chatgpt") {
      if (!this.cfg.openaiApiKey) throw new Error("OpenAI API key missing.");
      const body = {
        model: this.cfg.chatgptModel,
        messages: [{ role: "system", content: "You generate precise academic keywords." },
        { role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 220,
        top_p: 0.9
      };
      const resp = await Zotero.HTTP.request("POST", "https://api.openai.com/v1/chat/completions", {
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${this.cfg.openaiApiKey}` },
        body: JSON.stringify(body), timeout: 30000
      });
      if (resp.status !== 200) throw new Error(`OpenAI error ${resp.status}: ${resp.statusText}`);
      const data = JSON.parse(resp.responseText);
      const txt = data?.choices?.[0]?.message?.content || "";
      return this.parseKeywords(txt, n);
    }

    if (!this.cfg.geminiApiKey) throw new Error("Gemini API key missing.");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.cfg.geminiModel}:generateContent?key=${this.cfg.geminiApiKey}`;
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 220, topP: 0.9 }
    };
    const resp = await Zotero.HTTP.request("POST", url, {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), timeout: 30000
    });
    if (resp.status !== 200) throw new Error(`Gemini error ${resp.status}: ${resp.statusText}`);
    const data = JSON.parse(resp.responseText);
    const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return this.parseKeywords(txt, n);
  },

  // ==== Tag application ====
  getTagTargets(attachment, parent) {
    const t = this.cfg.tagTarget;
    const targets = [];
    if (t === "attachment" || t === "both") targets.push(attachment);
    if (parent && (t === "parent" || t === "both")) targets.push(parent);
    return Array.from(new Set(targets));
  },

  unionExistingTags(items) {
    const set = new Set();
    for (const it of items || []) {
      const tags = (it.getTags() || []).map(t => t.tag);
      for (const tg of tags) set.add(tg);
    }
    return Array.from(set);
  },

  async applyKeywords(item, keywords) {
    const existing = (item.getTags() || []).map(t => this.canon(t.tag));
    const exists = new Set(existing);
    const fresh = keywords.filter(k => !exists.has(this.canon(k)));
    for (const k of fresh) { try { item.addTag(k); } catch (e) { this.log("addTag error: " + e); } }
    await item.saveTx();
    return { added: fresh.length, skipped: keywords.length - fresh.length };
  },

  async applyKeywordsMulti(items, keywords) {
    let totalAdded = 0, totalSkipped = 0;
    for (const it of items) {
      const res = await this.applyKeywords(it, keywords);
      totalAdded += res.added;
      totalSkipped += res.skipped;
    }
    return { added: totalAdded, skipped: totalSkipped };
  },

  // ==== Main flow ====
  async generateKeywords(win = null) {
    const w = win || Zotero.getMainWindow();
    if (!w?.ZoteroPane) return void this.toast("Could not access Zotero window.");

    const selected = w.ZoteroPane.getSelectedItems();
    if (!selected.length) return void this.toast("Please select at least one item.");

    const pdfs = this.listPDFAttachments(selected);
    if (!pdfs.length) return void this.toast("No PDFs found in selection.");

    const provider = this.cfg.provider === "chatgpt" ? "ChatGPT" : "Gemini";
    if (this.cfg.provider === "chatgpt" && !this.cfg.openaiApiKey) return void this.toast("Configure your OpenAI key first.");
    if (this.cfg.provider === "gemini" && !this.cfg.geminiApiKey) return void this.toast("Configure your Gemini key first.");

    const pw = new Zotero.ProgressWindow();
    pw.changeHeadline(`Generating Keywords (${provider})`);
    pw.addDescription(`Processing ${pdfs.length} PDF(s)…`);
    pw.show();

    let ok = 0, errs = 0, totalAdded = 0;

    for (let i = 0; i < pdfs.length; i++) {
      const { attachment, parent } = pdfs[i];
      try {
        pw.addDescription(`• ${i + 1}/${pdfs.length}: ${attachment.getDisplayTitle()}`);
        const content = await this.extractContent(attachment);
        const targets = this.getTagTargets(attachment, parent);
        const existingTags = this.unionExistingTags(targets);
        const kws = await this.sendToLLM(this.cfg.provider, content, existingTags);
        if (!kws.length) throw new Error("No keywords returned");

        const res = await this.applyKeywordsMulti(targets, kws);
        totalAdded += res.added; ok++;
        pw.addDescription(`   ↳ added ${res.added} (targets: ${targets.length}), skipped ${res.skipped}`);
      } catch (e) {
        this.log("Item error: " + e); errs++;
        pw.addDescription(`   ↳ error: ${e.message || e}`);
      }
      await new Promise(r => setTimeout(r, this.cfg.PAUSE_MS));
    }

    pw.addDescription("Done.");
    pw.startCloseTimer(1500);
    this.toast(
      `Provider: ${provider}\nProcessed: ${ok}/${pdfs.length}\nKeywords added: ${totalAdded}\nErrors: ${errs || 0}\nTag scope: ${this.cfg.tagTarget}`,
      "Keyword Generator Results"
    );
  },

  // ==== Menu wiring ====
  updateMenuLabel(win) {
    try {
      const doc = win.document;
      const mi = doc.getElementById("keyword-generator-menuitem");
      if (mi) mi.setAttribute("label", `🔑 Generate Keywords (${this.cfg.provider === "chatgpt" ? "ChatGPT" : "Gemini"})`);
    } catch (e) { this.log("updateMenuLabel: " + e); }
  },

  addToWindow(win) {
    if (this.windows.has(win)) return;
    this.windows.add(win);

    const inject = () => {
      try {
        const doc = win.document;
        const itemMenu = doc.getElementById("zotero-itemmenu");
        if (!itemMenu) return;

        if (doc.getElementById("keyword-generator-menuitem")) return; // already added

        const sep = this.xul(doc, "menuseparator"); sep.id = "keyword-generator-separator";
        const gen = this.xul(doc, "menuitem"); gen.id = "keyword-generator-menuitem";
        const prov = this.xul(doc, "menuitem"); prov.id = "keyword-generator-provider-menuitem";
        const key = this.xul(doc, "menuitem"); key.id = "keyword-generator-api-key-menuitem";

        gen.setAttribute("label", `🔑 Generate Keywords (${this.cfg.provider === "chatgpt" ? "ChatGPT" : "Gemini"})`);
        prov.setAttribute("label", "🤖 Select AI Provider");
        key.setAttribute("label", "⚙️ Setup API Keys");

        const onGen = () => this.initialized && this.generateKeywords(win);
        const onProv = () => this.initialized && this.selectProvider(win);
        const onKey = () => this.initialized && this.setupApiKey(win);

        gen.addEventListener("command", onGen);
        prov.addEventListener("command", onProv);
        key.addEventListener("command", onKey);

        itemMenu.appendChild(sep);
        itemMenu.appendChild(gen);
        itemMenu.appendChild(prov);
        itemMenu.appendChild(key);

        win._kgListeners = { onGen, onProv, onKey };
      } catch (e) {
        this.log("addToWindow inject error: " + e);
      }
    };

    // Defer UI injection until after the window's event loop is idle (prevents first-run stalls)
    try {
      if (win.requestIdleCallback) win.requestIdleCallback(inject, { timeout: 1500 });
      else win.setTimeout(inject, 0);
    } catch {
      try { win.setTimeout(inject, 0); } catch { }
    }
  },

  removeFromWindow(win) {
    if (!this.windows.has(win)) return;
    const doc = win.document;
    const ids = ["keyword-generator-separator", "keyword-generator-menuitem",
      "keyword-generator-provider-menuitem", "keyword-generator-api-key-menuitem"];
    ids.forEach(id => {
      const el = doc.getElementById(id);
      if (!el) return;
      try {
        if (id === "keyword-generator-menuitem" && win._kgListeners?.onGen) el.removeEventListener("command", win._kgListeners.onGen);
        if (id === "keyword-generator-provider-menuitem" && win._kgListeners?.onProv) el.removeEventListener("command", win._kgListeners.onProv);
        if (id === "keyword-generator-api-key-menuitem" && win._kgListeners?.onKey) el.removeEventListener("command", win._kgListeners.onKey);
      } catch { }
      try { el.remove(); } catch { }
    });
    delete win._kgListeners;
    this.windows.delete(win);
  },

  // ==== Lifecycle ====
  async waitForUI() {
    try {
      if (Zotero.uiReadyPromise) await Zotero.uiReadyPromise;         // Zotero 7
      else if (Zotero.initializationPromise) await Zotero.initializationPromise; // Zotero 6
      else await new Promise(r => setTimeout(r, 1500));
    } catch (e) { this.log("uiReady wait error: " + e); }
  },

  async injectIntoMainWindowOnce() {
    try {
      const win = (Zotero.getMainWindow && Zotero.getMainWindow()) || null;
      if (win && win.ZoteroPane) this.addToWindow(win);
    } catch (e) { this.log("injectIntoMainWindowOnce error: " + e); }
  },

  async startup({ rootURI }) {
    this.rootURI = rootURI;
    this.initialized = false;

    // Defer EVERYTHING UI/prefs-related until UI is ready
    (async () => {
      await this.waitForUI();
      this.loadPrefs();

      // Only now start listening for new windows (prevents early chrome races)
      try { Services.wm.addListener(this.windowListener); } catch (e) { this.log("wm.addListener failed: " + e); }

      // Inject into the already-open main window without enumerating all windows
      await this.injectIntoMainWindowOnce();

      // Mark fully initialized only after prefs + injection
      this.initialized = true;
    })();
  },

  shutdown() {
    this.initialized = false;
    try { Services.wm.removeListener(this.windowListener); } catch { }
    for (const w of Array.from(this.windows)) this.removeFromWindow(w);
    this.windows.clear();
  },

  windowListener: {
    onOpenWindow(xulWin) {
      let win = null;
      try {
        win = xulWin.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindow);
      } catch { return; }
      const cb = () => {
        try {
          win.removeEventListener("load", cb);
          if (win.ZoteroPane) KeywordGenerator.addToWindow(win);
        } catch { }
      };
      try { win.addEventListener("load", cb); } catch { }
    },
    onCloseWindow() { },
    onWindowTitleChange() { }
  }
};

// Expose to window if present (safe no-op if not ready)
try { if (typeof window !== "undefined" && window.ZoteroPane) window.KeywordGenerator = KeywordGenerator; } catch { }

function startup(data) { try { KeywordGenerator.startup(data); } catch (e) { Zotero.debug("[KG startup] " + e); } }
function shutdown() { try { KeywordGenerator.shutdown(); } catch (e) { Zotero.debug("[KG shutdown] " + e); } }
function install() { }
function uninstall() { }
