(() => {
  "use strict";

  const demo = window.WORKBENCH_DEMO;
  if (!demo?.bundle) throw new Error("缺少演示数据 demo-data.js");

  const $ = (selector) => document.querySelector(selector);
  const elements = {
    projectTitle: $("#project-title"), projectMeta: $("#project-meta"),
    dataLabel: $("#data-label"), search: $("#insight-search"),
    filters: $("#status-filters"), insightCount: $("#insight-count"),
    insightList: $("#insight-list"), main: $("#main-content"),
    review: $("#review-content"), fileInput: $("#file-input"),
    drawer: $("#source-drawer"), drawerContent: $("#drawer-content"),
    backdrop: $("#drawer-backdrop"), toast: $("#toast"),
    guide: $("#guide-screen"), workspace: $("#workspace"),
    reportScreen: $("#report-screen"), reportContent: $("#report-content"),
    prepare: $("#prepare-panel"), questionInput: $("#new-research-question"),
    projectInput: $("#new-project-id"), taskPreview: $("#task-preview"),
    historyPanel: $("#history-panel"), historyList: $("#history-list"),
  };
  const labels = ["全部", "待审", "采纳", "修改后采纳", "驳回"];
  let dataset = { ...demo, isDemo: true, customThemes: [], themeSyntheses: [], synthesisRevision: "" };
  let selectedId = demo.bundle.insights[0]?.insight_id ?? null;
  let filter = "全部";
  let query = "";
  let lastFocus = null;
  let toastTimer = null;
  const inMemoryReviews = new Map();
  let datasetRevision = 0;
  const BOARD_DB = "interview-evidence-workbench";

  function node(tag, className = "", content = "") {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (content !== "") item.textContent = String(content);
    return item;
  }

  function put(parent, ...children) {
    for (const child of children) {
      if (child !== null && child !== undefined) parent.append(child);
    }
    return parent;
  }

  function wipe(parent) {
    parent.replaceChildren();
    return parent;
  }

  function button(label, className, onClick) {
    const item = node("button", className, label);
    item.type = "button";
    item.addEventListener("click", onClick);
    return item;
  }

  function keyFor(insightId) {
    return `interview-review:v1:${dataset.bundle.project.project_id}:${insightId}`;
  }

  function savedReview(insightId) {
    const key = keyFor(insightId);
    if (inMemoryReviews.has(key)) return inMemoryReviews.get(key);
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        const value = JSON.parse(stored);
        inMemoryReviews.set(key, value);
        return value;
      }
    } catch (_) { /* file:// can restrict storage in some browsers */ }
    return null;
  }

  function reviewFor(insight) {
    const saved = savedReview(insight.insight_id) || {};
    return {
      status: saved.status || insight.status || "待审",
      review_reason: saved.review_reason ?? insight.review_reason ?? "",
      final_statement: saved.final_statement ?? insight.statement ?? "",
      final_applies_to: saved.final_applies_to ?? insight.applies_to ?? "",
      final_theme_id: saved.final_theme_id ?? insight.theme_id ?? "UNSORTED",
      saved_at: saved.saved_at || "",
    };
  }

  function reviewIssues(insight) {
    const review = reviewFor(insight);
    if (review.status === "待审") return ["尚未审议"];
    const issues = [];
    if (review.status === "采纳" || review.status === "修改后采纳") {
      if (!review.final_statement.trim()) issues.push("缺少最终洞察结论");
      if (!review.final_applies_to.trim()) issues.push("缺少适用情境");
      if (!themeMap().has(review.final_theme_id)) issues.push("缺少有效主题");
    }
    return issues;
  }

  function reviewRevision() {
    const payload = JSON.stringify({
      project_id: dataset.bundle.project.project_id,
      question_version: dataset.bundle.project.question_version,
      insights: dataset.bundle.insights.map((insight) => {
        const review = reviewFor(insight);
        return {
          insight_id: insight.insight_id,
          theme_id: review.final_theme_id,
          status: review.status,
          final_statement: review.final_statement.trim(),
          final_applies_to: review.final_applies_to.trim(),
        };
      }),
    });
    let hash = 2166136261;
    for (let index = 0; index < payload.length; index += 1) {
      hash ^= payload.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `review-${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }

  function hasCurrentSynthesis() {
    return Array.isArray(dataset.themeSyntheses) && dataset.themeSyntheses.length > 0 &&
      dataset.synthesisRevision === reviewRevision();
  }

  function saveReview(insightId, value) {
    const key = keyFor(insightId);
    inMemoryReviews.set(key, value);
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      return false;
    }
  }

  function showToast(message, kind = "success") {
    elements.toast.textContent = message;
    elements.toast.dataset.kind = kind;
    elements.toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 3500);
  }

  function showGuide(openPrepare = false) {
    closeDrawer();
    elements.historyPanel.hidden = true;
    elements.guide.hidden = false;
    elements.workspace.hidden = true;
    elements.reportScreen.hidden = true;
    $("#guide-button").hidden = true;
    $("#export-button").hidden = true;
    $("#continue-review").hidden = dataset.isDemo;
    if (openPrepare) {
      elements.prepare.hidden = false;
      requestAnimationFrame(() => elements.prepare.scrollIntoView({ block: "start", behavior: "smooth" }));
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  async function showHistory() {
    showGuide();
    elements.historyPanel.hidden = false;
    await renderHistory();
    requestAnimationFrame(() => elements.historyPanel.scrollIntoView({ block: "start", behavior: "smooth" }));
  }

  function showWorkspace() {
    elements.guide.hidden = true;
    elements.workspace.hidden = false;
    elements.reportScreen.hidden = true;
    $("#guide-button").hidden = false;
    $("#export-button").hidden = false;
    window.scrollTo(0, 0);
    elements.main.focus({ preventScroll: true });
  }

  function analysisPrompt() {
    const question = elements.questionInput.value.trim();
    const projectId = elements.projectInput.value.trim();
    if (!question || !projectId) return "先填写项目 ID 和设计问题，再复制任务说明。";
    return `使用 $interview-insight-cards 处理我附上的匿名化访谈逐字稿 TXT。\n\n项目 ID：${projectId}\n设计问题：${question}\n\n请把这个较宽的设计问题原样保存到 project.research_question，作为本轮方案方向；不要擅自收窄成某一个局部行为问题。请先给原文标行号，再按 Skill 的 schema v0.2 提取可定位的原话、原子观察和候选洞察。保留相邻提问、证据类型、支持与限定证据、其他解释和待验证问题。全部洞察生成后，再按共同用户任务、障碍机制或体验结果建立 3—7 个主题，并给每条洞察分配一个主要主题；主题不要使用具体方案名称。未被原文支持的信息写为未知，不要补造。所有候选洞察保持“待审”，不要替设计师填写人工审议字段。\n\n请保存 bundle.json，并运行 cards.py validate。然后调用我当前打开的访谈证据台网页提供的 set_cards Site tool，把 bundle 和原始逐字稿写入看板。确认工具返回的项目 ID、访谈数、主题数和卡片数，再让我在网页逐卡审阅。若当前浏览器无法发现 set_cards，交给我 bundle.json 与原 TXT 以便手动导入。`;
  }

  function updateTaskPreview() {
    elements.taskPreview.value = analysisPrompt();
  }

  function formatSavedTime(value) {
    if (!value) return "较早保存";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "较早保存";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(date);
  }

  async function openSavedProject(saved, destination = "review") {
    loadSavedState(saved);
    await writeBoardState(saved);
    if (destination === "report") openReport();
    else showWorkspace();
    showToast(`已切换到项目 ${saved.bundle.project.project_id}。`);
  }

  async function renderHistory() {
    if (!elements.historyList) return;
    wipe(elements.historyList);
    let rows;
    try { rows = await listBoardStates(); }
    catch (_) {
      put(elements.historyList, node("p", "history-empty", "当前浏览器未允许读取历史项目。"));
      return;
    }
    if (!rows.length) {
      put(elements.historyList, node("p", "history-empty", "还没有保存的项目。导入第一份访谈后，它会出现在这里。"));
      return;
    }
    const currentId = dataset.isDemo ? "" : dataset.bundle.project.project_id;
    rows.forEach((saved) => {
      const project = saved.bundle.project;
      const fallback = { sessions: saved.bundle.sessions.length, insights: saved.bundle.insights.length,
        reviewed: 0, accepted: 0, hasSynthesis: Boolean(saved.themeSyntheses?.length) };
      const summary = { ...fallback, ...(saved.summary || {}) };
      const card = node("article", `history-card${project.project_id === currentId ? " is-current" : ""}`);
      const copy = node("div", "history-card-copy");
      const eyebrow = node("div", "history-card-eyebrow");
      put(eyebrow, node("span", "history-project-id", project.project_id),
        project.project_id === currentId ? node("span", "history-current", "当前项目") : null,
        node("span", "history-time", `保存于 ${formatSavedTime(saved.savedAt)}`));
      put(copy, eyebrow, node("h3", "", project.research_question));
      const facts = node("p", "history-facts",
        `${summary.sessions} 份访谈 · ${summary.insights} 条洞察 · 已审 ${summary.reviewed}/${summary.insights}`);
      put(copy, facts);
      const actions = node("div", "history-card-actions");
      const reviewButton = button(project.project_id === currentId ? "返回审阅" : "打开审阅", "button button-primary", () => {
        void openSavedProject(saved, "review").catch(() => showToast("项目恢复失败，请稍后再试。", "error"));
      });
      put(actions, reviewButton);
      if (summary.hasSynthesis) {
        put(actions, button("查看简报", "button button-soft", () => {
          void openSavedProject(saved, "report").catch(() => showToast("简报恢复失败，请稍后再试。", "error"));
        }));
      }
      put(card, copy, actions);
      put(elements.historyList, card);
    });
  }

  function maps() {
    const bundle = dataset.bundle;
    return {
      sessions: new Map(bundle.sessions.map((item) => [item.session_id, item])),
      excerpts: new Map(bundle.excerpts.map((item) => [item.excerpt_id, item])),
      observations: new Map(bundle.observations.map((item) => [item.observation_id, item])),
    };
  }

  function allThemes() {
    const themes = [...(dataset.bundle.themes || []), ...(dataset.customThemes || [])];
    return themes.length ? themes : [{ theme_id: "UNSORTED", label: "未分组", definition: "旧版材料或尚未确认主题的洞察。" }];
  }

  function themeMap() {
    return new Map(allThemes().map((theme) => [theme.theme_id, theme]));
  }

  function themeForInsight(insight) {
    const id = reviewFor(insight).final_theme_id;
    return themeMap().get(id) || { theme_id: "UNSORTED", label: "未分组", definition: "旧版材料或尚未确认主题的洞察。" };
  }

  function filteredInsights() {
    return dataset.bundle.insights.filter((insight) => {
      const status = reviewFor(insight).status;
      if (filter !== "全部" && status !== filter) return false;
      if (!query) return true;
      const haystack = [insight.insight_id, insight.statement, insight.applies_to, themeForInsight(insight).label,
        ...(insight.alternative_explanations || [])].join(" ").toLocaleLowerCase();
      return haystack.includes(query);
    });
  }

  function statusClass(status) {
    return status === "采纳" || status === "修改后采纳" ? "accepted" :
      status === "驳回" ? "rejected" : "pending";
  }

  function renderFilters() {
    wipe(elements.filters);
    for (const label of labels) {
      const count = label === "全部" ? dataset.bundle.insights.length :
        dataset.bundle.insights.filter((item) => reviewFor(item).status === label).length;
      const item = button(`${label} ${count}`, `filter-chip${filter === label ? " active" : ""}`, () => {
        filter = label;
        render();
      });
      item.setAttribute("aria-pressed", String(filter === label));
      elements.filters.append(item);
    }
  }

  function renderList(items) {
    wipe(elements.insightList);
    elements.insightCount.textContent = `${items.length} / ${dataset.bundle.insights.length}`;
    if (!items.length) {
      const empty = node("div", "rail-empty");
      put(empty, node("strong", "", "没有匹配的洞察"), node("p", "", "试试清除搜索或切换审议状态。"));
      elements.insightList.append(empty);
      return;
    }
    items.forEach((insight) => {
      const status = reviewFor(insight).status;
      const item = button("", `insight-item${selectedId === insight.insight_id ? " selected" : ""}`, () => {
        selectedId = insight.insight_id;
        render();
        elements.main.scrollTop = 0;
      });
      item.setAttribute("aria-current", selectedId === insight.insight_id ? "true" : "false");
      const head = node("span", "insight-item-head");
      put(head, node("span", "record-id", insight.insight_id), node("span", `status-dot ${statusClass(status)}`, status));
      put(item, head, node("span", "theme-chip", themeForInsight(insight).label),
        node("strong", "insight-item-title", insight.statement),
        node("span", "insight-item-foot", `${insight.support_observation_ids.length} 条支持 · ${(insight.limiting_observation_ids || []).length} 条限定`));
      elements.insightList.append(item);
    });
  }

  function eyebrow(text) { return node("span", "overline", text); }

  function sectionTitle(title, count, tone) {
    const head = node("div", `section-heading ${tone}`);
    put(head, node("h3", "", title), node("span", "section-count", `${count} 条`));
    return head;
  }

  function detail(label, value) {
    if (!value) return null;
    const wrap = node("div", "detail-pair");
    put(wrap, node("dt", "", label), node("dd", "", value));
    return wrap;
  }

  function evidenceCard(observation, tone, lookups, expanded = false) {
    const card = node("details", `evidence-card ${tone}`);
    card.open = expanded;
    const summary = node("summary", "evidence-summary");
    const top = node("div", "evidence-card-top");
    put(top, node("span", "record-id", observation.observation_id),
      node("span", "evidence-type", observation.evidence_type));
    const firstExcerpt = lookups.excerpts.get(observation.excerpt_ids[0]);
    const firstSession = lookups.sessions.get(firstExcerpt?.session_id);
    put(summary, top, node("h4", "", observation.action),
      node("span", "evidence-summary-source", `${firstSession?.participant_code || firstExcerpt?.session_id || "来源未记录"} · L${firstExcerpt?.line_start || "?"}`));
    card.append(summary);
    const body = node("div", "evidence-body");

    const facts = node("dl", "fact-grid");
    [detail("任务", observation.task), detail("情境", observation.context),
      detail("阻碍", observation.obstacle), detail("直接后果", observation.consequence),
      detail("应对办法", observation.workaround)].forEach((entry) => entry && facts.append(entry));
    if (facts.childElementCount) body.append(facts);

    const citations = node("div", "citation-stack");
    for (const excerptId of observation.excerpt_ids) {
      const excerpt = lookups.excerpts.get(excerptId);
      if (!excerpt) continue;
      const session = lookups.sessions.get(excerpt.session_id);
      const quote = node("div", "quote-block");
      const quoteHeader = node("div", "quote-header");
      put(quoteHeader, node("span", "", `${session?.participant_code || excerpt.session_id} · ${excerpt.session_id} · L${excerpt.line_start}`),
        node("span", "", excerptId));
      quote.append(quoteHeader);
      if (excerpt.preceding_question) {
        quote.append(node("p", "preceding-question", `访谈员：${excerpt.preceding_question}`));
      }
      quote.append(node("blockquote", "", `“${excerpt.quote}”`));
      quote.append(button("查看访谈上下文", "text-action", () => openDrawer(excerptId, lookups)));
      citations.append(quote);
    }
    body.append(citations);
    if (observation.unknown?.length) {
      const unknown = node("div", "unknown-line");
      put(unknown, node("strong", "", "仍未知"), node("span", "", observation.unknown.join("；")));
      body.append(unknown);
    }
    card.append(body);
    return card;
  }

  function evidenceSection(title, ids, tone, lookups) {
    const section = node("section", "evidence-section");
    section.append(sectionTitle(title, ids.length, tone));
    if (!ids.length) {
      section.append(node("p", "empty-evidence", "当前没有记录这类证据。"));
    } else {
      for (const [index, id] of ids.entries()) {
        const observation = lookups.observations.get(id);
        if (observation) section.append(evidenceCard(observation, tone, lookups, index === 0));
      }
    }
    return section;
  }

  function listSection(title, items, className) {
    const section = node("section", `synthesis-section ${className}`);
    section.append(node("h3", "", title));
    const list = node("ul", "synthesis-list");
    if (!items?.length) list.append(node("li", "empty-list", "尚未记录"));
    else items.forEach((item) => list.append(node("li", "", item)));
    section.append(list);
    return section;
  }

  function renderMain(insight) {
    wipe(elements.main);
    if (!insight) {
      const empty = node("div", "main-empty");
      put(empty, eyebrow("当前视图"), node("h2", "", "这里还没有可审议的洞察"),
        node("p", "", "导入含有访谈、片段、观察和候选洞察的 JSON 文件，或调整左侧筛选。"));
      elements.main.append(empty);
      return;
    }
    const review = reviewFor(insight);
    const lookups = maps();
    const header = node("div", "insight-header");
    const meta = node("div", "insight-kicker");
    put(meta, node("span", "record-id", insight.insight_id),
      node("span", "theme-chip", themeForInsight(insight).label),
      node("span", `status-pill ${statusClass(review.status)}`, review.status));
    put(header, meta, node("h2", "insight-statement", insight.statement),
      node("p", "applies-to", insight.applies_to || "适用用户与场景尚未记录"));
    const caution = node("div", "interpretation-note");
    caution.append(node("span", "note-symbol", "i"));
    caution.append(node("p", "", "这是基于访谈生成的候选问题。请核对证据、反例和其他解释，再决定是否采纳。"));
    header.append(caution);

    const evidence = node("div", "evidence-columns");
    evidence.append(evidenceSection("支持这项判断", insight.support_observation_ids, "support", lookups));
    evidence.append(evidenceSection("限定或相反的情况", insight.limiting_observation_ids || [], "limiting", lookups));

    const synthesis = node("div", "synthesis-grid");
    synthesis.append(listSection("还可能由什么造成", insight.alternative_explanations, "alternative"));
    synthesis.append(listSection("下一步要验证什么", insight.open_questions, "questions"));

    const types = [...insight.support_observation_ids, ...(insight.limiting_observation_ids || [])]
      .map((id) => lookups.observations.get(id)?.evidence_type).filter(Boolean);
    const foot = node("p", "evidence-footnote", types.length && !types.includes("现场观察到的行为")
      ? "当前引用的证据均非现场观察。后续可用照片、取物过程记录或情境观察核对。"
      : "每条原话均可从来源记录继续核对。"
    );
    const readingRoute = node("div", "reading-route");
    put(readingRoute, node("strong", "", "建议阅读顺序"),
      node("span", "", "1 看候选判断"), node("span", "", "2 对照支持与限定证据"),
      node("span", "", "3 打开原话上下文"), node("span", "", "4 在右侧记录决定"));
    put(elements.main, readingRoute, header, evidence, synthesis, foot);
  }

  function field(label, control, help = "") {
    const wrap = node("label", "form-field");
    put(wrap, node("span", "field-label", label), help ? node("small", "field-help", help) : null, control);
    return wrap;
  }

  function selectNextPending(currentId) {
    const insights = dataset.bundle.insights;
    const start = Math.max(0, insights.findIndex((item) => item.insight_id === currentId));
    for (let offset = 1; offset <= insights.length; offset += 1) {
      const candidate = insights[(start + offset) % insights.length];
      if (reviewFor(candidate).status === "待审") {
        selectedId = candidate.insight_id;
        filter = "待审";
        query = "";
        elements.search.value = "";
        render();
        elements.main.scrollIntoView({ block: "start", behavior: "smooth" });
        return;
      }
    }
    showToast("没有下一条待审洞察；可以生成讨论简报或检查已审记录。 ");
  }

  function renderReview(insight) {
    wipe(elements.review);
    if (!insight) {
      elements.review.append(node("p", "review-placeholder", "选择一张候选洞察开始审议。"));
      return;
    }
    const review = reviewFor(insight);
    const top = node("div", "review-heading");
    put(top, node("h2", "", "这项洞察能否进入方案构思？"),
      node("p", "", "直接采纳时沿用 AI 原文；选择“修改后采纳”才需要改写结论、情境或主题。"));
    elements.review.append(top);
    const form = node("form", "review-form");
    const select = node("select", "form-control");
    select.name = "status";
    select.id = "review-status";
    for (const status of labels.slice(1)) {
      const option = node("option", "", status);
      option.value = status;
      select.append(option);
    }
    select.value = review.status;
    const finalStatement = node("textarea", "form-control handoff-input");
    finalStatement.rows = 5;
    finalStatement.value = review.final_statement;
    finalStatement.placeholder = "用一句完整的话写清用户、情境和问题，不写具体方案。";
    const finalScope = node("textarea", "form-control handoff-input");
    finalScope.rows = 3;
    finalScope.value = review.final_applies_to;
    finalScope.placeholder = "这项结论适用于谁、在什么情境下？";
    const themeSelect = node("select", "form-control");
    themeSelect.name = "theme";
    allThemes().forEach((theme) => {
      const option = node("option", "", theme.label);
      option.value = theme.theme_id;
      themeSelect.append(option);
    });
    themeSelect.value = review.final_theme_id;
    const customThemeInput = node("input", "form-control");
    customThemeInput.type = "text";
    customThemeInput.placeholder = "输入新的主题标签";
    const addThemeButton = node("button", "button button-soft add-theme-button", "新增并选中");
    addThemeButton.type = "button";
    const themeAddRow = node("div", "theme-add-row");
    put(themeAddRow, customThemeInput, addThemeButton);
    const themeEditor = node("div", "theme-editor");
    put(themeEditor, themeSelect, themeAddRow);
    const handoffFields = node("div", "handoff-fields");
    put(handoffFields, field("修改后的最终洞察结论", finalStatement),
      field("适用人群与情境", finalScope),
      field("主题标签", themeEditor, "可以改选其他 AI 主题，或新增一个自己的标签并选中。"));
    const reason = node("textarea", "form-control reason-input");
    reason.rows = 5;
    reason.placeholder = "可选：补充采纳、修改或驳回的判断依据。填写后会作为小字进入讨论简报。";
    reason.value = review.review_reason;
    put(form, field("审议结果", select), handoffFields,
      field("审议说明（选填）", reason, "填写后会显示在对应洞察下方，并进入复制、下载和打印版简报。"));
    const syncHandoffFields = () => {
      handoffFields.hidden = select.value !== "修改后采纳";
    };
    select.addEventListener("change", syncHandoffFields);
    addThemeButton.addEventListener("click", () => {
      const label = customThemeInput.value.trim();
      if (!label) {
        showToast("先输入新的主题标签。", "error");
        customThemeInput.focus();
        return;
      }
      const existing = allThemes().find((theme) => theme.label === label);
      let theme = existing;
      if (!theme) {
        theme = { theme_id: `CUSTOM-${Date.now().toString(36).toUpperCase()}`, label, definition: "" };
        dataset.customThemes.push(theme);
        const option = node("option", "", theme.label);
        option.value = theme.theme_id;
        themeSelect.append(option);
        void persistActiveBoard().catch(() => {});
      }
      themeSelect.value = theme.theme_id;
      customThemeInput.value = "";
      form.dataset.dirty = "true";
      showToast(existing ? "已切换到同名主题。" : "已新增并选中主题；保存审议记录后生效。 ");
    });
    syncHandoffFields();
    const save = node("button", "button button-primary save-button", "保存审议记录");
    save.type = "submit";
    const next = node("button", "button button-soft next-button", "下一个待审");
    next.type = "button";
    next.addEventListener("click", () => {
      if (form.dataset.dirty === "true") {
        showToast("当前修改尚未保存，请先保存审议记录。", "error");
        return;
      }
      selectNextPending(insight.insight_id);
    });
    const actions = node("div", "review-actions");
    put(actions, save, next);
    form.append(actions);
    const note = node("p", "local-note", "全部审议完成后，Codex 会按人工确认后的主题与洞察生成设计机会、HMW 和待筛选的创意方案种子。旧综合结果会在洞察修改后自动失效。 ");
    form.append(note);
    const savedAt = node("p", "saved-at", review.saved_at ? `上次保存：${formatTime(review.saved_at)}` : "尚未在此网页保存");
    form.append(savedAt);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const status = select.value;
      const explanation = reason.value.trim();
      const accepted = status === "采纳" || status === "修改后采纳";
      const modified = status === "修改后采纳";
      const statement = modified ? finalStatement.value.trim() : insight.statement.trim();
      const appliesTo = modified ? finalScope.value.trim() : insight.applies_to.trim();
      const themeId = modified ? themeSelect.value : (insight.theme_id || "UNSORTED");
      if (accepted && (!statement || !appliesTo || !themeMap().has(themeId))) {
        showToast("修改后采纳需要最终结论、适用情境和有效主题。", "error");
        (!statement ? finalStatement : !appliesTo ? finalScope : themeSelect).focus();
        return;
      }
      const previousRevision = reviewRevision();
      const stored = saveReview(insight.insight_id, {
        status, review_reason: explanation,
        final_statement: statement, final_applies_to: appliesTo,
        final_theme_id: themeId,
        saved_at: new Date().toISOString(),
      });
      if (previousRevision !== reviewRevision()) {
        dataset.themeSyntheses = [];
        dataset.synthesisRevision = "";
        void persistActiveBoard().catch(() => {});
      }
      showToast(stored ? "审议记录已保存；如结论有变化，旧的 AI 综合已失效。" : "已暂存本页，但浏览器限制了持久保存；请不要关闭页面。", stored ? "success" : "error");
      render();
    });
    form.dataset.dirty = "false";
    form.addEventListener("input", () => { form.dataset.dirty = "true"; });
    form.addEventListener("change", () => { form.dataset.dirty = "true"; });
    elements.review.append(form);
    const mini = node("div", "review-source-note");
    put(mini, node("span", "overline", "证据提醒"),
      node("p", "", `${insight.support_observation_ids.length} 条支持 · ${(insight.limiting_observation_ids || []).length} 条限定。数量只表示引用条数，不代表证据强度。`));
    elements.review.append(mini);
  }

  function formatTime(value) {
    try { return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
    catch (_) { return value; }
  }

  function renderDrawer(excerptId, lookups) {
    wipe(elements.drawerContent);
    const excerpt = lookups.excerpts.get(excerptId);
    if (!excerpt) return;
    const session = lookups.sessions.get(excerpt.session_id);
    const intro = node("div", "drawer-intro");
    put(intro, node("strong", "", `${session?.participant_code || excerpt.session_id} · ${excerpt.session_id}`),
      node("p", "", session?.context || "访谈情境未记录"));
    const metadata = node("div", "drawer-meta");
    put(metadata, node("span", "", session?.date || "日期未记录"),
      node("span", "", session?.method || "方法未记录"),
      node("span", "", `逐字稿版本 ${session?.transcript_version || "?"}`));
    intro.append(metadata);
    const sourceUrl = dataset.sourceDocs?.[excerpt.session_id] || session?.source_url;
    if (typeof sourceUrl === "string" && /^https:\/\//i.test(sourceUrl)) {
      const a = node("a", "source-link", "打开来源文档 ↗");
      a.href = sourceUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      intro.append(a);
    }
    elements.drawerContent.append(intro);

    const transcript = node("div", "transcript");
    const sourceName = session?.source_file || "";
    const lines = dataset.transcripts?.[sourceName] || dataset.transcripts?.[sourceName.split(/[\\/]/).pop()] || [];
    if (lines.length) {
      lines.forEach((line, index) => {
        const number = index + 1;
        const active = number >= excerpt.line_start && number <= excerpt.line_end;
        const adjacent = number === excerpt.line_start - 1;
        const row = node("div", `transcript-row${active ? " active" : adjacent ? " adjacent" : ""}`);
        if (active) row.dataset.targetLine = "true";
        put(row, node("span", "line-number", String(number).padStart(2, "0")), node("p", "", line));
        transcript.append(row);
      });
    } else {
      const missing = node("div", "transcript-missing");
      put(missing, node("strong", "", "原始逐字稿尚未加载"),
        node("p", "", "让 Codex 在 set_cards 中附上对应的逐字稿，或手动导入 JSON 与 TXT，即可查看完整上下文。"),
        node("blockquote", "", `“${excerpt.quote}”`));
      transcript.append(missing);
    }
    put(elements.drawerContent, node("h3", "drawer-section-title", `${session?.source_file || "原文件"} · L${excerpt.line_start}–L${excerpt.line_end}`), transcript);
    requestAnimationFrame(() => transcript.querySelector('[data-target-line="true"]')?.scrollIntoView({ block: "center" }));
  }

  function openDrawer(excerptId, lookups) {
    lastFocus = document.activeElement;
    renderDrawer(excerptId, lookups);
    elements.backdrop.hidden = false;
    elements.drawer.inert = false;
    elements.drawer.classList.add("open");
    elements.drawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("drawer-open");
    elements.drawer.focus();
  }

  function closeDrawer() {
    elements.backdrop.hidden = true;
    elements.drawer.inert = true;
    elements.drawer.classList.remove("open");
    elements.drawer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("drawer-open");
    lastFocus?.focus?.();
  }

  function render() {
    const project = dataset.bundle.project;
    elements.projectTitle.textContent = project.research_question;
    const completed = dataset.bundle.insights.filter((insight) => !reviewIssues(insight).length).length;
    elements.projectMeta.textContent = `${project.project_id} · 问题版本 ${project.question_version} · 已审 ${completed}/${dataset.bundle.insights.length}`;
    elements.dataLabel.textContent = dataset.isSample ? "已审简报示例" : dataset.isDemo ? "模拟案例" : `当前项目 · ${project.project_id}`;
    $("#demo-scale").textContent = `内置模拟案例：${demo.bundle.sessions.length} 份访谈、${demo.bundle.excerpts.length} 段原话、${demo.bundle.observations.length} 条观察、${demo.bundle.insights.length} 张待审卡。每份材料都明确标为虚构。`;
    const items = filteredInsights();
    if (!items.some((item) => item.insight_id === selectedId)) selectedId = items[0]?.insight_id ?? null;
    renderFilters();
    renderList(items);
    const selected = items.find((item) => item.insight_id === selectedId) ?? null;
    renderMain(selected);
    renderReview(selected);
  }

  function validateBundle(bundle) {
    if (!bundle || !["0.1", "0.2"].includes(bundle.schema_version) || !bundle.project?.project_id || !bundle.project?.research_question ||
        !Array.isArray(bundle.sessions) || !Array.isArray(bundle.excerpts) ||
        !Array.isArray(bundle.observations) || !Array.isArray(bundle.insights)) {
      throw new Error("需要 schema v0.1/v0.2 的完整 bundle：项目、访谈、片段、观察和候选洞察。请先运行 cards.py validate。");
    }
    if (!bundle.sessions.length || !bundle.insights.length) throw new Error("bundle 至少需要一份访谈和一张候选洞察卡。");
    const unique = (rows, key) => rows.every((row) => row && typeof row[key] === "string" && row[key].trim()) &&
      new Set(rows.map((row) => row[key])).size === rows.length;
    if (!unique(bundle.sessions, "session_id") || !unique(bundle.excerpts, "excerpt_id") ||
        !unique(bundle.observations, "observation_id") || !unique(bundle.insights, "insight_id")) {
      throw new Error("JSON 含重复稳定 ID，请先修复并重新导入。");
    }
    const sessionIds = new Set(bundle.sessions.map((item) => item.session_id));
    const excerptIds = new Set(bundle.excerpts.map((item) => item.excerpt_id));
    const observationIds = new Set(bundle.observations.map((item) => item.observation_id));
    const themes = Array.isArray(bundle.themes) ? bundle.themes : [];
    const themeIds = new Set(themes.map((theme) => theme.theme_id));
    if (bundle.schema_version === "0.2" && (!themes.length ||
        themes.some((theme) => !theme.theme_id || !theme.label || !theme.definition) || themeIds.size !== themes.length ||
        bundle.insights.some((item) => !themeIds.has(item.theme_id)))) {
      throw new Error("v0.2 bundle 的主题缺失、重复，或洞察引用了不存在的主题。");
    }
    if (bundle.excerpts.some((item) => !sessionIds.has(item.session_id) || !Number.isInteger(item.line_start) ||
          !Number.isInteger(item.line_end) || item.line_start < 1 || item.line_end < item.line_start ||
          typeof item.quote !== "string" || !item.quote.trim()) ||
        bundle.observations.some((item) => !Array.isArray(item.excerpt_ids) || item.excerpt_ids.some((id) => !excerptIds.has(id))) ||
        bundle.insights.some((item) => !Array.isArray(item.support_observation_ids) ||
          !Array.isArray(item.limiting_observation_ids || []) ||
          [...item.support_observation_ids, ...(item.limiting_observation_ids || [])].some((id) => !observationIds.has(id)))) {
      throw new Error("JSON 中有找不到的访谈、片段或观察引用，请先运行 cards.py validate。");
    }
  }

  function normalizeTranscripts(input) {
    if (input === undefined) return {};
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("transcripts 须为文件名到逐字稿文本的映射。");
    const transcripts = {};
    for (const [name, value] of Object.entries(input)) {
      if (!name || (typeof value !== "string" && !Array.isArray(value))) throw new Error("逐字稿文件名或内容格式无效。");
      if (Array.isArray(value) && value.some((line) => typeof line !== "string")) throw new Error("逐字稿每一行都应是文字。");
      const lines = typeof value === "string" ? value.split(/\r?\n/) : value.slice();
      if (lines.at(-1) === "") lines.pop();
      transcripts[name] = lines;
    }
    return transcripts;
  }

  function openBoardDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error("浏览器不支持本机保存"));
      const request = indexedDB.open(BOARD_DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("state");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function projectStorageKey(projectId) {
    return `project:${projectId}`;
  }

  async function readBoardState(key = "active") {
    const db = await openBoardDb();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction("state", "readonly");
        const request = transaction.objectStore("state").get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally { db.close(); }
  }

  async function writeBoardState(value, includeInHistory = true) {
    const db = await openBoardDb();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction("state", "readwrite");
        const store = transaction.objectStore("state");
        store.put(value, "active");
        if (includeInHistory) store.put(value, projectStorageKey(value.bundle.project.project_id));
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally { db.close(); }
  }

  async function listBoardStates() {
    const db = await openBoardDb();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction("state", "readonly");
        const request = transaction.objectStore("state").openCursor();
        const rows = [];
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            rows.sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));
            resolve(rows);
            return;
          }
          if (typeof cursor.key === "string" && cursor.key.startsWith("project:") && cursor.value?.bundle?.project) {
            rows.push(cursor.value);
          }
          cursor.continue();
        };
        request.onerror = () => reject(request.error);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally { db.close(); }
  }

  function boardStateSnapshot() {
    const reviews = dataset.bundle.insights.map((insight) => reviewFor(insight));
    const reviewed = reviews.filter((review) => review.status !== "待审").length;
    const accepted = reviews.filter((review) => review.status === "采纳" || review.status === "修改后采纳").length;
    return {
      bundle: dataset.bundle,
      transcripts: dataset.transcripts || {},
      customThemes: dataset.customThemes || [],
      themeSyntheses: dataset.themeSyntheses || [],
      synthesisRevision: dataset.synthesisRevision || "",
      savedAt: new Date().toISOString(),
      summary: {
        sessions: dataset.bundle.sessions.length,
        insights: dataset.bundle.insights.length,
        reviewed,
        accepted,
        hasSynthesis: Array.isArray(dataset.themeSyntheses) && dataset.themeSyntheses.length > 0,
      },
    };
  }

  async function persistActiveBoard() {
    await writeBoardState(boardStateSnapshot());
    void renderHistory();
  }

  function loadSavedState(saved) {
    validateBundle(saved.bundle);
    datasetRevision += 1;
    dataset = { bundle: saved.bundle, transcripts: normalizeTranscripts(saved.transcripts),
      customThemes: Array.isArray(saved.customThemes) ? saved.customThemes : [],
      themeSyntheses: Array.isArray(saved.themeSyntheses) ? saved.themeSyntheses : [],
      synthesisRevision: typeof saved.synthesisRevision === "string" ? saved.synthesisRevision : "",
      sourceDocs: {}, baseUrl: "", isDemo: false };
    selectedId = saved.bundle.insights[0]?.insight_id ?? null;
    filter = "全部";
    query = "";
    elements.search.value = "";
    closeDrawer();
    render();
  }

  async function applyDataset(bundle, transcripts, source) {
    validateBundle(bundle);
    const normalized = normalizeTranscripts(transcripts);
    const serialized = JSON.stringify({ bundle, transcripts: normalized });
    if (serialized.length > 3_000_000) throw new Error("材料超过浏览器导入上限（约 3 MB），请分项目处理。");
    const sessionFiles = new Map(bundle.sessions.map((session) => [session.session_id, session.source_file]));
    for (const excerpt of bundle.excerpts) {
      const fileName = sessionFiles.get(excerpt.session_id) || "";
      const lines = normalized[fileName] || normalized[fileName.split(/[\\/]/).pop()];
      if (lines && (excerpt.line_end > lines.length ||
          !lines.slice(excerpt.line_start - 1, excerpt.line_end).join("\n").includes(excerpt.quote))) {
        throw new Error(`逐字稿 ${fileName} 的 L${excerpt.line_start}–L${excerpt.line_end} 无法定位原话 ${excerpt.excerpt_id}。`);
      }
    }
    datasetRevision += 1;
    dataset = { bundle, transcripts: normalized, customThemes: [], themeSyntheses: [], synthesisRevision: "", sourceDocs: {}, baseUrl: "", isDemo: false };
    selectedId = bundle.insights[0]?.insight_id ?? null;
    filter = "全部";
    query = "";
    elements.search.value = "";
    closeDrawer();
    render();
    showWorkspace();
    let persisted = true;
    try { await persistActiveBoard(); }
    catch (_) { persisted = false; }
    showToast(`已从${source}载入 ${bundle.sessions.length} 份访谈、${bundle.insights.length} 张候选洞察。${persisted ? "" : "刷新前请导出；本机保存失败。"}`, persisted ? "success" : "error");
    return { project_id: bundle.project.project_id, sessions: bundle.sessions.length,
      excerpts: bundle.excerpts.length, observations: bundle.observations.length,
      themes: (bundle.themes || []).length, insights: bundle.insights.length,
      persisted_in_browser: persisted };
  }

  async function restoreBoard() {
    const revision = datasetRevision;
    try {
      const saved = await readBoardState();
      if (!saved || revision !== datasetRevision) return;
      loadSavedState(saved);
      if (!saved.savedAt || !(await readBoardState(projectStorageKey(saved.bundle.project.project_id)))) {
        await writeBoardState({ ...saved, savedAt: saved.savedAt || new Date().toISOString(),
          summary: saved.summary || boardStateSnapshot().summary });
      }
      showGuide();
      void renderHistory();
    } catch (_) { /* A missing or unavailable browser store leaves the demo usable. */ }
  }

  function synthesisContext() {
    const incomplete = dataset.bundle.insights.filter((insight) => reviewIssues(insight).length);
    if (incomplete.length) throw new Error(`还有 ${incomplete.length} 张洞察卡尚未完成审议，不能开始第二次 AI 综合。`);
    const approved = approvedInsights();
    if (!approved.length) throw new Error("没有已采纳的洞察可用于生成设计机会和 HMW。");
    const observationLookup = maps().observations;
    const grouped = new Map();
    approved.forEach((insight) => {
      const review = reviewFor(insight);
      const theme = themeForInsight(insight);
      if (!grouped.has(theme.theme_id)) grouped.set(theme.theme_id, { ...theme, insights: [] });
      grouped.get(theme.theme_id).insights.push({
        insight_id: insight.insight_id,
        final_statement: review.final_statement,
        final_applies_to: review.final_applies_to,
        limiting_conditions: (insight.limiting_observation_ids || []).map((id) => {
          const item = observationLookup.get(id) || {};
          return { observation_id: id, context: item.context || "", action: item.action || "",
            obstacle: item.obstacle || "", consequence: item.consequence || "" };
        }),
        alternative_explanations: insight.alternative_explanations || [],
        open_questions: insight.open_questions || [],
      });
    });
    return { project: dataset.bundle.project, review_revision: reviewRevision(), themes: [...grouped.values()] };
  }

  async function setDesignSynthesis(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        typeof input.review_revision !== "string" || !Array.isArray(input.themes) ||
        Object.keys(input).some((key) => !["review_revision", "themes"].includes(key))) {
      throw new Error("set_design_synthesis 需要 review_revision 和 themes，不能包含其他字段。");
    }
    const context = synthesisContext();
    if (input.review_revision !== context.review_revision) {
      throw new Error("审阅内容已发生变化，请重新读取 get_synthesis_context 后再生成综合结果。");
    }
    const themes = new Map(context.themes.map((theme) => [theme.theme_id, theme]));
    if (input.themes.length !== themes.size) {
      throw new Error("综合结果必须覆盖每个包含已采纳洞察的主题。");
    }
    const usedThemes = new Set();
    const usedHmwIds = new Set();
    const usedConceptIds = new Set();
    const cleaned = input.themes.map((result) => {
      if (!result || typeof result !== "object" || typeof result.theme_id !== "string" || usedThemes.has(result.theme_id)) {
        throw new Error("每个主题只能有一份综合结果。");
      }
      usedThemes.add(result.theme_id);
      const theme = themes.get(result.theme_id);
      if (!theme) throw new Error(`${result.theme_id} 不是当前已采纳洞察所属的主题。`);
      if (!Array.isArray(result.source_insight_ids) || !result.source_insight_ids.length ||
          result.source_insight_ids.some((id) => !theme.insights.some((insight) => insight.insight_id === id))) {
        throw new Error(`${result.theme_id} 的来源洞察必须来自该主题下已采纳的洞察。`);
      }
      if (typeof result.opportunity_statement !== "string" || !result.opportunity_statement.trim() ||
          !Array.isArray(result.open_questions || []) || (result.open_questions || []).some((item) => typeof item !== "string")) {
        throw new Error(`${result.theme_id} 缺少设计机会方向或开放问题。`);
      }
      if (!Array.isArray(result.hmw_candidates) || result.hmw_candidates.length < 1 || result.hmw_candidates.length > 2) {
        throw new Error(`${result.theme_id} 需要 1—2 条 HMW 候选。`);
      }
      const hmwCandidates = result.hmw_candidates.map((candidate) => {
        if (!candidate || typeof candidate !== "object" || !candidate.hmw_id || usedHmwIds.has(candidate.hmw_id) ||
            typeof candidate.question !== "string" || !candidate.question.includes("如何")) {
          throw new Error(`${result.theme_id} 的每条 HMW 需要唯一 ID，并使用包含“如何”的开放式问题。`);
        }
        usedHmwIds.add(candidate.hmw_id);
        return { hmw_id: String(candidate.hmw_id), question: candidate.question.trim() };
      });
      const themeHmwIds = new Set(hmwCandidates.map((candidate) => candidate.hmw_id));
      if (!Array.isArray(result.concept_candidates) || result.concept_candidates.length < 2 || result.concept_candidates.length > 4) {
        throw new Error(`${result.theme_id} 需要 2—4 个创意方案种子，供设计师下一步筛选。`);
      }
      const conceptCandidates = result.concept_candidates.map((concept) => {
        if (!concept || typeof concept !== "object" || !concept.concept_id || usedConceptIds.has(concept.concept_id) ||
            typeof concept.title !== "string" || !concept.title.trim() ||
            typeof concept.summary !== "string" || !concept.summary.trim() ||
            !Array.isArray(concept.interaction_steps) || concept.interaction_steps.length < 2 || concept.interaction_steps.length > 4 ||
            concept.interaction_steps.some((step) => typeof step !== "string" || !step.trim()) ||
            typeof concept.expected_effect !== "string" || !concept.expected_effect.trim() ||
            typeof concept.validation_focus !== "string" || !concept.validation_focus.trim() ||
            !Array.isArray(concept.responds_to_hmw_ids) || !concept.responds_to_hmw_ids.length ||
            concept.responds_to_hmw_ids.some((id) => !themeHmwIds.has(id))) {
          throw new Error(`${result.theme_id} 的创意方案需要唯一 ID、标题、详细构想、2—4 步使用过程、预期改善、内部 HMW 关联和验证重点。`);
        }
        usedConceptIds.add(concept.concept_id);
        return { concept_id: String(concept.concept_id), title: concept.title.trim(), summary: concept.summary.trim(),
          interaction_steps: concept.interaction_steps.map((step) => step.trim()),
          expected_effect: concept.expected_effect.trim(),
          responds_to_hmw_ids: [...new Set(concept.responds_to_hmw_ids)], validation_focus: concept.validation_focus.trim(),
          status: "AI 创意，待小组筛选" };
      });
      return {
        theme_id: result.theme_id,
        source_insight_ids: [...new Set(result.source_insight_ids)],
        opportunity_statement: result.opportunity_statement.trim(),
        open_questions: (result.open_questions || []).map((item) => item.trim()).filter(Boolean),
        hmw_candidates: hmwCandidates,
        concept_candidates: conceptCandidates,
        status: "AI 综合，待小组讨论", generated_at: new Date().toISOString(),
      };
    });
    dataset.themeSyntheses = cleaned;
    dataset.synthesisRevision = context.review_revision;
    let persisted = true;
    try { await persistActiveBoard(); } catch (_) { persisted = false; }
    if (!elements.reportScreen.hidden) openReport();
    showToast(`已基于当前审阅版本完成 ${cleaned.length} 个主题的第二次 AI 综合。`);
    return { project_id: dataset.bundle.project.project_id, review_revision: context.review_revision,
      themes_synthesized: cleaned.length,
      hmw_candidates: cleaned.reduce((total, item) => total + item.hmw_candidates.length, 0),
      concept_candidates: cleaned.reduce((total, item) => total + item.concept_candidates.length, 0),
      persisted_in_browser: persisted };
  }

  function registerSiteTool() {
    const registry = document.modelContext;
    const status = $("#site-tool-status");
    if (typeof registry?.registerTool !== "function") {
      status.textContent = "当前浏览器未提供 Site tools；仍可用下方的手动文件导入。";
      return;
    }
    try {
      const registrations = [registry.registerTool({
        name: "set_cards",
        description: "Write a validated interview-insight-cards schema v0.1/v0.2 bundle and optional original TXT transcripts into the currently open review board. v0.2 includes AI-proposed themes. This switches the active board to the new project, keeps earlier projects in browser-local history, keeps human reviews for matching project/card IDs, and saves the board in this browser. Use only after the user has asked to send these research materials to this page. Return counts and local-save status.",
        inputSchema: {
          type: "object", additionalProperties: false, required: ["bundle"],
          properties: {
            bundle: { type: "object", description: "Complete schema v0.1/v0.2 JSON bundle from the interview-insight-cards skill. New results should use v0.2 themes and pending insights." },
            transcripts: { type: "object", description: "Optional map: each session.source_file filename to its original TXT as a string. Use unnumbered original physical lines.", additionalProperties: { type: "string" } },
          },
        },
        async execute(input) {
          if (!input || typeof input !== "object" || Array.isArray(input) ||
              !Object.hasOwn(input, "bundle") || Object.keys(input).some((key) => !["bundle", "transcripts"].includes(key))) {
            throw new Error("set_cards 需要 bundle，可附 transcripts；不能包含其他字段。");
          }
          const { bundle, transcripts } = input;
          validateBundle(bundle);
          if (bundle.insights.some((item) => item.status !== "待审" || item.reviewer || item.review_reason)) {
            throw new Error("set_cards 只接收待审卡片；人工审议状态请在网页完成。");
          }
          if (!dataset.isDemo && bundle.project.project_id === dataset.bundle.project.project_id &&
              JSON.stringify(bundle) !== JSON.stringify(dataset.bundle) &&
              dataset.bundle.insights.some((item) => reviewFor(item).status !== "待审")) {
            throw new Error("当前项目已有人工审议，不能用同一项目 ID 的新分析覆盖证据。请另设项目 ID 后再写入。");
          }
          return applyDataset(bundle, transcripts, "Codex");
        },
      }), registry.registerTool({
        name: "get_synthesis_context",
        description: "Read the current human-approved insight conclusions from this page for a second AI pass after all cards are reviewed. Returns human-confirmed theme assignments (including selected or custom themes), final statements, scopes, limiting evidence, open questions, the broad design question and an exact review_revision. Rejected insights and raw transcripts are not returned.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true },
        execute(input) {
          if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length) {
            throw new Error("get_synthesis_context 不接收参数。");
          }
          return synthesisContext();
        },
      }), registry.registerTool({
        name: "set_design_synthesis",
        description: "Write the second-pass AI synthesis into this page. The input must echo the exact current review_revision and cover every theme containing approved insights. Each theme result contains one solution-neutral opportunity statement, 1–2 HMW candidates, 2–4 detailed concept candidates, source insight IDs and open questions. Every concept includes a title, detailed summary, 2–4 interaction steps, expected effect, validation focus and internal HMW links. HMW links are retained for validation but hidden from the human-facing report. A stale revision is rejected.",
        inputSchema: {
          type: "object", additionalProperties: false, required: ["review_revision", "themes"],
          properties: {
            review_revision: { type: "string" },
            themes: { type: "array", maxItems: 7, items: { type: "object" } },
          },
        },
        execute: setDesignSynthesis,
      })];
      void Promise.all(registrations.map((item) => Promise.resolve(item))).then(() => {
        status.textContent = "已连接 Codex：可接收洞察卡，并在人工审议后执行带版本校验的第二次 AI 综合。";
      })
        .catch(() => { status.textContent = "Site tools 连接失败；可用下方的手动文件导入。"; });
    } catch (_) { status.textContent = "Site tools 连接失败；可用下方的手动文件导入。"; }
  }

  async function importFiles(fileList) {
    const files = [...fileList];
    const jsonFiles = files.filter((file) => file.name.toLowerCase().endsWith(".json"));
    if (jsonFiles.length !== 1) throw new Error("请一次选择 1 份 bundle.json；逐字稿 .txt 可同时多选。");
    const bundle = JSON.parse(await jsonFiles[0].text());
    validateBundle(bundle);
    const transcripts = {};
    for (const file of files.filter((item) => item.name.toLowerCase().endsWith(".txt"))) {
      transcripts[file.name] = (await file.text()).split(/\r?\n/);
      if (transcripts[file.name].at(-1) === "") transcripts[file.name].pop();
    }
    await applyDataset(bundle, transcripts, "文件");
  }

  function reportDetail(label, value, className = "") {
    const item = node("dl", `report-detail ${className}`);
    put(item, node("dt", "", label), node("dd", "", value));
    return item;
  }

  function openSampleReport() {
    const bundle = JSON.parse(JSON.stringify(demo.bundle));
    bundle.project.project_id = "DEMO-P02-REVIEWED";
    dataset = { ...demo, bundle, isDemo: true, isSample: true, customThemes: [], themeSyntheses: [], synthesisRevision: "" };
    const examples = [
      ["采纳", "备菜盒集中存放且目标盒被挡时，取用需要移开并放回其他容器；购买量会改变这一负担。"],
      ["修改后采纳", "两人按不同规则归位时，常用备菜盒可能需要重新寻找或询问位置。"],
      ["采纳", "较高容器与现有层高不匹配时，调整层架可能挤占其他物品的空间；换容器也是一种替代做法。"],
      ["采纳", "相似且不透明的备菜盒可能需要拉出或开盖才能辨认，标签又可能在清洗后失效。"],
      ["驳回", ""],
      ["采纳", "下层抽屉装得较满时，取常用蔬菜可能需要弯腰、拉抽屉并移开其他食材。"],
      ["采纳", "备餐并非每周持续进行，冷藏空间需要同时适应集中备菜与当天购买当天做两种节奏。"],
      ["驳回", ""],
      ["驳回", ""],
    ];
    bundle.insights.forEach((insight, index) => {
      const [status, statement] = examples[index];
      inMemoryReviews.set(keyFor(insight.insight_id), {
        status,
        review_reason: status === "驳回" ? "虚构审议示例：当前证据不足以让这项判断直接进入方案构思。" : "虚构审议示例：已确认最终措辞和设计目标。",
        final_statement: statement || insight.statement,
        final_applies_to: insight.applies_to,
        saved_at: new Date().toISOString(),
      });
    });
    dataset.synthesisRevision = reviewRevision();
    dataset.themeSyntheses = [
      { theme_id: "T01", source_insight_ids: ["DEMO-I01", "DEMO-I06"], opportunity_statement: "让工作日备餐者在装载量变化时仍能看见并直接取到高频食材，减少移动其他物品和弯腰翻找。", open_questions: ["高频食材位置是否因身高而不同？"], hmw_candidates: [{ hmw_id: "DEMO-HMW01", question: "我们如何让高频食材在冷藏室装载量变化时仍保持可见和可达？" }, { hmw_id: "DEMO-HMW02", question: "我们如何减少取出后排或低位食材时移动其他物品的次数？" }], concept_candidates: [{ concept_id: "DEMO-C01", title: "高频食材前置托盘", summary: "用可前后移动的浅托盘承载一组常用备菜盒，取后排内容时整组前移，减少逐件搬动。", responds_to_hmw_ids: ["DEMO-HMW01", "DEMO-HMW02"], validation_focus: "不同装载量下是否仍能单手拉出，且不会遮挡相邻食材。", status: "AI 创意，待小组筛选" }, { concept_id: "DEMO-C02", title: "可变高度高频区", summary: "在视线与腰部之间设置可快速调高的局部层架，让高频食材随装载量改变仍位于易见易取的位置。", responds_to_hmw_ids: ["DEMO-HMW01"], validation_focus: "不同身高使用者的舒适高度，以及调整动作是否足够简单。", status: "AI 创意，待小组筛选" }], status: "AI 综合，待小组讨论" },
      { theme_id: "T02", source_insight_ids: ["DEMO-I02"], opportunity_statement: "让共同使用者更容易知道常用食材被放回哪里，减少询问和反复寻找，同时允许成员保留各自习惯。", open_questions: ["位置提示与共同规则哪一种更容易长期维持？"], hmw_candidates: [{ hmw_id: "DEMO-HMW03", question: "我们如何让共同使用者在归位规则不同的情况下仍能快速知道常用食材的位置？" }], concept_candidates: [{ concept_id: "DEMO-C03", title: "双人共享归位带", summary: "用一条可移动的共享区域承载双方都会取用的食材，其余区域保留个人摆放习惯。", responds_to_hmw_ids: ["DEMO-HMW03"], validation_focus: "共享区的边界是否无需额外解释也能被两位使用者理解。", status: "AI 创意，待小组筛选" }, { concept_id: "DEMO-C04", title: "位置状态翻牌", summary: "在常用食材区设置可手动翻转的简短位置标识，成员改变位置时顺手留下可见线索。", responds_to_hmw_ids: ["DEMO-HMW03"], validation_focus: "使用者是否愿意持续维护标识，以及维护成本是否低于口头询问。", status: "AI 创意，待小组筛选" }], status: "AI 综合，待小组讨论" },
      { theme_id: "T03", source_insight_ids: ["DEMO-I03", "DEMO-I07"], opportunity_statement: "让同一冷藏空间适应不同高度容器和不规律备餐量，减少为了短期变化重排整层物品。", open_questions: ["真实容器尺寸分布和切换频率是多少？"], hmw_candidates: [{ hmw_id: "DEMO-HMW04", question: "我们如何让冷藏空间适应不同高度容器和不规律备餐量，同时避免每次变化都重排整层物品？" }], concept_candidates: [{ concept_id: "DEMO-C05", title: "局部快速调高层架", summary: "把整层调节拆成左右两个可独立升降的小单元，只为较高容器让出局部空间。", responds_to_hmw_ids: ["DEMO-HMW04"], validation_focus: "承重、清洁和单手调节是否能同时成立。", status: "AI 创意，待小组筛选" }, { concept_id: "DEMO-C06", title: "弹性备餐模组", summary: "用可折叠边界在集中备餐时扩展成多盒区，平日收起后释放给当天购买的食材。", responds_to_hmw_ids: ["DEMO-HMW04"], validation_focus: "模组收放后是否真正减少重排，而非制造新的占位和清洁负担。", status: "AI 创意，待小组筛选" }], status: "AI 综合，待小组讨论" },
      { theme_id: "T04", source_insight_ids: ["DEMO-I04"], opportunity_statement: "让多盒备餐者更容易辨认内容和日期，并让识别信息在清洗与归位后仍容易维持。", open_questions: ["用户更依赖位置、外观还是文字标识？"], hmw_candidates: [{ hmw_id: "DEMO-HMW05", question: "我们如何让多盒备餐者在不反复拉盒或开盖的情况下辨认内容和日期？" }], concept_candidates: [{ concept_id: "DEMO-C07", title: "俯视可读盒盖", summary: "让盒盖保留可擦写的食材与日期区域，使堆叠后的内容从正面或上方仍可辨认。", responds_to_hmw_ids: ["DEMO-HMW05"], validation_focus: "冷凝水、清洗和重复书写后信息是否仍清晰。", status: "AI 创意，待小组筛选" }, { concept_id: "DEMO-C08", title: "低维护日期滑标", summary: "在盒体上设置只需滑动一次的日期标记，减少贴标签和清洗后重贴的步骤。", responds_to_hmw_ids: ["DEMO-HMW05"], validation_focus: "日期粒度是否够用，以及滑标会不会在取放中误动。", status: "AI 创意，待小组筛选" }], status: "AI 综合，待小组讨论" },
    ];
    const sampleConceptDetails = {
      "DEMO-C01": { interaction_steps: ["把同一餐次的备菜盒放入浅托盘", "拉动前端把整组食材带到可见范围", "取出目标盒后将托盘整体推回"], expected_effect: "在后排被遮挡时减少逐盒搬出和放回，并保留原有分类关系。" },
      "DEMO-C02": { interaction_steps: ["根据当周装载量选择高频区位置", "单手调节局部层架高度", "把常用食材集中在视线与腰部之间"], expected_effect: "在装载量变化时仍维持高频食材的可见性和舒适取用高度。" },
      "DEMO-C03": { interaction_steps: ["两位使用者确定共享食材范围", "移动边界形成共享区与个人区", "采购或装载变化时重新滑动边界"], expected_effect: "让分区变化保持可读，减少共同使用者之间的询问和重新寻找。" },
      "DEMO-C04": { interaction_steps: ["为常用位置设置简短状态标识", "临时改变食材位置时翻转标识", "另一位使用者依据标识取用并归位"], expected_effect: "在不强制统一摆放习惯的情况下，留下足够的位置变化线索。" },
      "DEMO-C05": { interaction_steps: ["识别需要较高空间的容器", "只调节对应一侧的局部层架", "容器移除后将局部层架恢复"], expected_effect: "只为局部高度变化让出空间，避免重新整理整层物品。" },
      "DEMO-C06": { interaction_steps: ["集中备餐时展开模组边界", "按餐次放入多组备菜盒", "非备餐周收起模组释放连续空间"], expected_effect: "让同一空间在集中备餐与日常少量储存之间切换，减少固定专用区闲置。" },
      "DEMO-C07": { interaction_steps: ["装盒时在盒盖记录内容与日期", "堆叠后从前方或上方扫视信息", "清洗后擦除并重新使用标识区"], expected_effect: "让不透明或相似容器在原位即可辨认，减少反复拉出和开盖。" },
      "DEMO-C08": { interaction_steps: ["放入食物时拨到对应日期", "取用前查看日期和优先级", "清空后将拨片复位"], expected_effect: "用一次机械操作替代贴纸或反复书写，降低日期信息的维护负担。" },
    };
    dataset.themeSyntheses.forEach((theme) => theme.concept_candidates.forEach((concept) => {
      Object.assign(concept, sampleConceptDetails[concept.concept_id] || {});
    }));
    selectedId = bundle.insights[0]?.insight_id ?? null;
    filter = "全部";
    query = "";
    elements.search.value = "";
    render();
    openReport();
  }

  function approvedInsights() {
    return dataset.bundle.insights.filter((insight) => {
      const status = reviewFor(insight).status;
      return status === "采纳" || status === "修改后采纳";
    });
  }

  function approvedGroups() {
    const groups = new Map();
    const configured = allThemes();
    configured.forEach((theme) => groups.set(theme.theme_id, { theme, insights: [] }));
    approvedInsights().forEach((insight) => {
      const theme = themeForInsight(insight);
      if (!groups.has(theme.theme_id)) groups.set(theme.theme_id, { theme, insights: [] });
      groups.get(theme.theme_id).insights.push(insight);
    });
    return [...groups.values()].filter((group) => group.insights.length);
  }

  function synthesisForTheme(themeId) {
    return (dataset.themeSyntheses || []).find((item) => item.theme_id === themeId) || null;
  }

  function synthesisPrompt() {
    return "请基于当前打开的访谈证据台完成第二次 AI 综合。先调用 get_synthesis_context 读取宽泛设计问题、人工审阅后的最终洞察、人工调整后的主题和 review_revision；再按每个主题生成 1 条不含具体方案的设计机会方向、1—2 条不同侧重点的 HMW，以及 2—4 个差异明显的创意方案种子。每个方案必须包含：标题；详细方案构想（写清适用情境、核心结构或机制，避免只写一句口号）；2—4 步使用过程；预期改善；最先需要验证的事项；以及供系统校验使用的 HMW ID 关联。HMW 关联只用于内部追溯，不会显示在简报里。请同时保留待验证问题。最后使用同一个 review_revision 调用 set_design_synthesis 写回网页。不要使用驳回项，也不要把 HMW、预期改善或创意方案写成已经验证的研究结论。";
  }

  function renderHandoffReport() {
    const bundle = dataset.bundle;
    const approved = approvedInsights();
    const groups = approvedGroups();
    const report = node("article", "handoff-report");
    const header = node("header", "");
    put(header, node("p", "report-kicker", "供小组归总与方案构思"),
      node("h1", "", "设计洞察讨论简报"),
      node("p", "report-question", `设计问题：${bundle.project.research_question}`));
    const meta = node("div", "report-meta");
    put(meta, node("span", "", `生成日期：${formatTime(new Date().toISOString())}`),
      node("span", "", `已审议 ${bundle.insights.length} 项 · 进入构思 ${approved.length} 项`));
    header.append(meta);
    if (dataset.isDemo || String(bundle.project.project_id).startsWith("DEMO")) {
      header.append(node("p", "report-demo", "本简报使用完全虚构的模拟访谈与模拟审议，仅供检验流程和版式，不可作为真实用户研究结论。"));
    }
    report.append(header);
    report.append(node("p", "report-lead", "洞察结论已经人工确认；设计机会与 HMW 为基于当前审阅版本的 AI 综合，供小组讨论和改写。"));
    if (!approved.length) {
      report.append(node("p", "report-empty", "本轮没有确认可进入方案构思的洞察。请先补充材料或重新界定设计问题。"));
    }
    groups.forEach((group, groupIndex) => {
      const section = node("section", "report-theme");
      const themeHead = node("header", "report-theme-head");
      put(themeHead, node("span", "report-theme-number", `主题 ${String(groupIndex + 1).padStart(2, "0")}`),
        node("h2", "", group.theme.label), group.theme.definition ? node("p", "", group.theme.definition) : null);
      section.append(themeHead);
      group.insights.forEach((insight, index) => {
        const review = reviewFor(insight);
        const item = node("article", "report-item");
        put(item, node("span", "report-item-label", `已确认洞察 ${String(index + 1).padStart(2, "0")}`),
          node("h3", "", review.final_statement),
          reportDetail("适用人群与情境", review.final_applies_to));
        if (review.review_reason) item.append(node("p", "report-review-note", `审议说明：${review.review_reason}`));
        section.append(item);
      });
      const synthesis = synthesisForTheme(group.theme.theme_id);
      const hmw = node("div", "report-hmw");
      hmw.append(node("h3", "", "第二次 AI 综合"));
      if (!synthesis) {
        hmw.append(node("p", "report-hmw-empty", "本组尚未完成基于人工审阅结果的第二次 AI 综合。"));
      } else {
        hmw.append(reportDetail("设计机会方向", synthesis.opportunity_statement, "report-goal"));
        const candidateGroup = node("div", "report-hmw-candidates");
        candidateGroup.append(node("h4", "", "进入方案讨论的 HMW 候选"));
        synthesis.hmw_candidates.forEach((candidate) => {
          const card = node("article", "report-hmw-card");
          put(card, node("span", "report-hmw-status", synthesis.status || "AI 综合，待小组讨论"),
            node("h4", "", candidate.question));
          candidateGroup.append(card);
        });
        const concepts = node("div", "report-concepts");
        concepts.append(node("h4", "", "AI 创意方案种子 · 待小组筛选"));
        (synthesis.concept_candidates || []).forEach((concept) => {
          const card = node("article", "report-concept-card");
          put(card, node("span", "report-concept-status", concept.status || "AI 创意，待小组筛选"),
            node("h5", "", concept.title),
            reportDetail("方案构想", concept.summary, "report-concept-summary"),
            concept.interaction_steps?.length ? reportDetail("使用过程", concept.interaction_steps.map((step, index) => `${index + 1}. ${step}`).join("　→　")) : null,
            concept.expected_effect ? reportDetail("预期改善", concept.expected_effect) : null,
            reportDetail("最先验证", concept.validation_focus));
          concepts.append(card);
        });
        hmw.append(candidateGroup, concepts);
        if (synthesis.open_questions?.length) hmw.append(reportDetail("仍待验证", synthesis.open_questions.join("；")));
      }
      section.append(hmw);
      report.append(section);
    });
    wipe(elements.reportContent).append(report);
  }

  function openReport() {
    closeDrawer();
    elements.guide.hidden = true;
    elements.workspace.hidden = true;
    elements.reportScreen.hidden = false;
    $("#guide-button").hidden = false;
    $("#export-button").hidden = true;
    const incomplete = dataset.bundle.insights.map((insight) => ({ insight, issues: reviewIssues(insight) }))
      .filter((item) => item.issues.length);
    $("#report-actions").hidden = incomplete.length > 0 || !hasCurrentSynthesis();
    if (incomplete.length) {
      $("#report-toolbar-title").textContent = "还不能生成讨论简报";
      $("#report-toolbar-note").textContent = `还有 ${incomplete.length} 项待审或待补全。`;
      const gate = node("div", "report-gate");
      put(gate, node("span", "overline", "交接前检查"),
        node("h1", "", "先把每项洞察审完"),
        node("p", "", "采纳的洞察需要最终表述、适用情境和有效主题；审议说明可以留空。简报只收录采纳的结论。"));
      const list = node("div", "report-gate-list");
      incomplete.forEach(({ insight, issues }) => {
        const item = button("", "report-gate-item", () => {
          selectedId = insight.insight_id;
          filter = "全部";
          query = "";
          elements.search.value = "";
          render();
          showWorkspace();
        });
        put(item, node("strong", "", insight.statement),
          node("span", "", issues.join("；")));
        list.append(item);
      });
      put(gate, list);
      wipe(elements.reportContent).append(gate);
    } else if (!hasCurrentSynthesis()) {
      const stale = Array.isArray(dataset.themeSyntheses) && dataset.themeSyntheses.length > 0;
      $("#report-toolbar-title").textContent = "等待第二次 AI 综合";
      $("#report-toolbar-note").textContent = stale ? "洞察修改后，旧综合结果已失效。" : "人工审阅已完成。";
      const gate = node("div", "report-gate synthesis-gate");
      put(gate, node("span", "overline", "审阅版本已锁定"),
        node("h1", "", stale ? "请根据最新审阅结果重新综合" : "请让 Codex 读取已审结果并生成讨论简报"),
        node("p", "", "Codex 会通过页面工具直接读取结构化的人工确认结果，不需要抓取文件或逐屏读取。写回成功后本页立即更新，无需刷新。"));
      const prompt = node("textarea", "synthesis-prompt");
      prompt.readOnly = true;
      prompt.rows = 7;
      prompt.value = synthesisPrompt();
      const copy = button("复制第二次 AI 综合指令", "button button-primary", async () => {
        try {
          await navigator.clipboard.writeText(synthesisPrompt());
          showToast("指令已复制，请粘贴到当前 Codex 对话。 ");
        } catch (_) {
          prompt.focus();
          prompt.select();
          showToast("浏览器未允许自动复制；已选中指令，请手动复制。", "error");
        }
      });
      put(gate, prompt, copy);
      wipe(elements.reportContent).append(gate);
    } else {
      $("#report-toolbar-title").textContent = "设计洞察讨论简报";
      $("#report-toolbar-note").textContent = "人工确认洞察 + 当前版本的 AI 综合";
      renderHandoffReport();
    }
    window.scrollTo(0, 0);
  }

  function reportPlainText() {
    const approved = approvedInsights();
    const lines = ["设计洞察讨论简报", `设计问题：${dataset.bundle.project.research_question}`,
      `生成日期：${formatTime(new Date().toISOString())}`, ""];
    if (dataset.isDemo || String(dataset.bundle.project.project_id).startsWith("DEMO")) {
      lines.push("注意：以下内容为完全虚构的模拟材料，不可作为真实研究结论。", "");
    }
    if (!approved.length) lines.push("本轮没有确认可进入方案构思的洞察。");
    approvedGroups().forEach((group, groupIndex) => {
      lines.push(`主题 ${groupIndex + 1}：${group.theme.label}`);
      if (group.theme.definition) lines.push(group.theme.definition);
      lines.push("");
      group.insights.forEach((insight, index) => {
        const review = reviewFor(insight);
        lines.push(`已确认洞察 ${index + 1}：${review.final_statement}`,
          `适用人群与情境：${review.final_applies_to}`);
        if (review.review_reason) lines.push(`审议说明：${review.review_reason}`);
        lines.push("");
      });
      const synthesis = synthesisForTheme(group.theme.theme_id);
      if (!synthesis) return;
      lines.push(`设计机会方向：${synthesis.opportunity_statement}`, "进入方案讨论的 HMW 候选：");
      synthesis.hmw_candidates.forEach((candidate, index) => lines.push(`${index + 1}. ${candidate.question}`));
      lines.push("", "AI 创意方案种子（待小组筛选）：");
      (synthesis.concept_candidates || []).forEach((concept, index) => {
        lines.push(`${index + 1}. ${concept.title}`, `方案构想：${concept.summary}`);
        if (concept.interaction_steps?.length) lines.push(`使用过程：${concept.interaction_steps.map((step, stepIndex) => `${stepIndex + 1}. ${step}`).join(" → ")}`);
        if (concept.expected_effect) lines.push(`预期改善：${concept.expected_effect}`);
        lines.push(`最先验证：${concept.validation_focus}`, "");
      });
      lines.push(synthesis.open_questions?.length ? `仍待验证：${synthesis.open_questions.join("；")}` : "", "");
    });
    return lines.join("\n");
  }

  function reportMarkdown() {
    const lines = ["# 设计洞察讨论简报", "", `**设计问题：** ${dataset.bundle.project.research_question}`,
      "", `生成日期：${formatTime(new Date().toISOString())}`, ""];
    if (dataset.isDemo || String(dataset.bundle.project.project_id).startsWith("DEMO")) {
      lines.push("> 注意：以下内容为完全虚构的模拟材料，不可作为真实研究结论。", "");
    }
    if (!approvedInsights().length) lines.push("本轮没有确认可进入方案构思的洞察。", "");
    approvedGroups().forEach((group, groupIndex) => {
      lines.push(`## 主题 ${groupIndex + 1}：${group.theme.label}`, "");
      if (group.theme.definition) lines.push(group.theme.definition, "");
      group.insights.forEach((insight, index) => {
        const review = reviewFor(insight);
        lines.push(`### 已确认洞察 ${index + 1}`, "", review.final_statement, "",
          `- **适用人群与情境：** ${review.final_applies_to}`);
        if (review.review_reason) lines.push(`- **审议说明：** ${review.review_reason}`);
        lines.push("");
      });
      const synthesis = synthesisForTheme(group.theme.theme_id);
      if (!synthesis) return;
      lines.push("### 第二次 AI 综合", "", `**设计机会方向：** ${synthesis.opportunity_statement}`, "",
        "#### 进入方案讨论的 HMW 候选", "");
      synthesis.hmw_candidates.forEach((candidate) => lines.push(`- ${candidate.question}`));
      lines.push("", "#### AI 创意方案种子（待小组筛选）", "");
      (synthesis.concept_candidates || []).forEach((concept, index) => {
        lines.push(`##### ${index + 1}. ${concept.title}`, "", `**方案构想：** ${concept.summary}`, "");
        if (concept.interaction_steps?.length) {
          lines.push("**使用过程：**", "");
          concept.interaction_steps.forEach((step, stepIndex) => lines.push(`${stepIndex + 1}. ${step}`));
          lines.push("");
        }
        if (concept.expected_effect) lines.push(`**预期改善：** ${concept.expected_effect}`, "");
        lines.push(`**最先验证：** ${concept.validation_focus}`, "");
      });
      if (synthesis.open_questions?.length) {
        lines.push("#### 仍待验证", "");
        synthesis.open_questions.forEach((question) => lines.push(`- ${question}`));
        lines.push("");
      }
    });
    return lines.join("\n");
  }

  function reportHtml() {
    const styles = $("#report-document-style").textContent;
    const content = elements.reportContent.innerHTML;
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>设计洞察讨论简报</title><style>body{margin:0;background:#eef3f3}${styles}</style></head><body>${content}</body></html>`;
  }

  function downloadReport() {
    const blob = new Blob([reportHtml()], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeId = String(dataset.bundle.project.project_id).replace(/[^a-zA-Z0-9_-]/g, "-");
    link.href = url;
    link.download = `${safeId}_设计洞察讨论简报.html`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("讨论简报已下载为可直接阅读的 HTML 文件。 ");
  }

  function downloadMarkdown() {
    const blob = new Blob([reportMarkdown()], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeId = String(dataset.bundle.project.project_id).replace(/[^a-zA-Z0-9_-]/g, "-");
    link.href = url;
    link.download = `${safeId}_设计洞察讨论简报.md`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("讨论简报已下载为 Markdown 文件。 ");
  }

  elements.search.addEventListener("input", (event) => {
    query = event.target.value.trim().toLocaleLowerCase();
    render();
  });
  $("#guide-button").addEventListener("click", () => showGuide());
  $("#guide-history-button").addEventListener("click", () => { void showHistory(); });
  $("#prepare-button").addEventListener("click", () => {
    elements.prepare.hidden = false;
    requestAnimationFrame(() => elements.prepare.scrollIntoView({ block: "start", behavior: "smooth" }));
  });
  $("#try-demo").addEventListener("click", () => {
    datasetRevision += 1;
    dataset = { ...demo, isDemo: true, customThemes: [], themeSyntheses: [], synthesisRevision: "" };
    selectedId = demo.bundle.insights[0]?.insight_id ?? null;
    filter = "全部";
    query = "";
    elements.search.value = "";
    render();
    showWorkspace();
  });
  $("#sample-report-button").addEventListener("click", openSampleReport);
  $("#continue-review").addEventListener("click", showWorkspace);
  $("#choose-files").addEventListener("click", () => elements.fileInput.click());
  elements.questionInput.addEventListener("input", updateTaskPreview);
  elements.projectInput.addEventListener("input", updateTaskPreview);
  $("#copy-task").addEventListener("click", async () => {
    if (!elements.questionInput.value.trim() || !elements.projectInput.value.trim()) {
      showToast("先填写项目 ID 和设计问题。", "error");
      (!elements.projectInput.value.trim() ? elements.projectInput : elements.questionInput).focus();
      return;
    }
    try {
      await navigator.clipboard.writeText(analysisPrompt());
      showToast("任务说明已复制。请在 Codex 中粘贴并附上逐字稿 TXT。 ");
    } catch (_) {
      elements.taskPreview.focus();
      elements.taskPreview.select();
      showToast("浏览器未允许自动复制；已选中任务说明，请手动复制。", "error");
    }
  });
  elements.fileInput.addEventListener("change", async (event) => {
    if (!event.target.files?.length) return;
    try { await importFiles(event.target.files); }
    catch (error) { showToast(error.message || "导入失败，请检查文件格式。", "error"); }
    finally { elements.fileInput.value = ""; }
  });
  $("#export-button").addEventListener("click", openReport);
  $("#report-back").addEventListener("click", showWorkspace);
  $("#report-download").addEventListener("click", downloadReport);
  $("#report-markdown").addEventListener("click", downloadMarkdown);
  $("#report-print").addEventListener("click", () => window.print());
  $("#report-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(reportPlainText());
      showToast("简报正文已复制，可粘贴到飞书文档或 Codex。 ");
    } catch (_) {
      showToast("浏览器未允许复制；可下载 HTML 或打印为 PDF。", "error");
    }
  });
  $("#drawer-close").addEventListener("click", closeDrawer);
  elements.backdrop.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDrawer(); });

  updateTaskPreview();
  render();
  showGuide();
  void restoreBoard();
  registerSiteTool();
})();
