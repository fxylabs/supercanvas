/* Canvas Common Rules runtime: active constraints and feedback-derived promotion candidates. */
(function () {
  "use strict";

  var dataElement = document.querySelector("#canvas-data");
  var data = dataElement ? JSON.parse(dataElement.textContent) : {};
  var rulesData = data.rules || { rulesRevision: 0, scope: "workspace", title: "Canvas Common Rules", description: "", source: null, rules: [] };
  var button = document.querySelector("#rules-btn");
  var view = document.querySelector("#rules-view");
  var search = document.querySelector("#rules-search");
  var nav = document.querySelector("#rules-nav");
  var results = document.querySelector("#rules-results");
  var activeStatus = "all";
  if (!button || !view || !search || !nav || !results) return;

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function announce(message) {
    var toast = document.querySelector("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(function () { toast.classList.remove("show"); }, 2400);
  }

  function copyJson(value, message) {
    var text = JSON.stringify(value, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { announce(message); }, function () { announce("정의 데이터를 펼쳐 복사하세요."); });
    } else announce("정의 데이터를 펼쳐 복사하세요.");
  }

  function sourceLabel(source) {
    if (!source) return "출처 없음";
    var labels = { "user-instruction": "사용자 명시 규칙", feedback: "댓글 피드백", "agent-proposal": "Agent 제안", maintainer: "Maintainer" };
    return (labels[source.type] || source.type) + (source.ref ? " · #" + source.ref : "");
  }

  function fileRules() {
    return (rulesData.rules || []).map(function (rule) { return { kind: "rule", value: rule }; });
  }

  function feedbackRules() {
    if (!window.__canvas) return [];
    var promotedRefs = new Set((rulesData.rules || []).map(function (rule) { return rule.source?.type === "feedback" ? rule.source.ref : null; }).filter(Boolean));
    return window.__canvas.loadComments().filter(function (comment) {
      return comment.ruleProposal && comment.ruleProposal.status !== "rejected" && !promotedRefs.has(comment.id);
    }).map(function (comment) {
      var proposal = comment.ruleProposal;
      return {
        kind: "feedback",
        commentId: comment.id,
        value: {
          id: "proposal-" + comment.id,
          title: proposal.title || "댓글에서 발견한 공통 규칙",
          status: proposal.status,
          priority: proposal.priority || "should",
          category: proposal.category,
          statement: proposal.statement,
          rationale: proposal.rationale || "이 댓글이 여러 Frame 또는 Canvas에 반복 적용될 수 있습니다.",
          appliesTo: proposal.appliesTo || [comment.target.type],
          source: { type: "feedback", ref: comment.id },
          verification: proposal.verification || { type: "agent-checklist", checks: [proposal.statement] }
        }
      };
    });
  }

  function allEntries() {
    return fileRules().concat(feedbackRules());
  }

  function updateProposal(commentId, status) {
    if (!window.__canvas) return;
    var comments = window.__canvas.loadComments();
    var comment = comments.find(function (item) { return item.id === commentId; });
    if (!comment || !comment.ruleProposal) return;
    comment.ruleProposal.status = status;
    comment.updatedAt = new Date().toISOString();
    window.__canvas.saveComments(comments);
    render();
    announce(status === "approved" ? "규칙 후보를 승인했습니다. 피드백 저장 후 Agent가 공통 규칙으로 반영합니다." : "규칙 후보를 폐기했습니다.");
  }

  function definitionDetails(value) {
    var details = element("details", "rules-definition");
    details.appendChild(element("summary", null, "정의 데이터 보기"));
    details.appendChild(element("pre", null, JSON.stringify(value, null, 2)));
    return details;
  }

  function ruleCard(entry) {
    var rule = entry.value;
    var effectiveStatus = rule.status === "approved" ? "proposed" : rule.status;
    var card = element("article", "rule-card status-" + effectiveStatus + " priority-" + rule.priority);
    card.dataset.status = effectiveStatus;
    card.dataset.search = [rule.id, rule.title, rule.category, rule.statement, rule.rationale, (rule.appliesTo || []).join(" ")].join(" ").toLocaleLowerCase();
    var head = element("header", "rule-card-head");
    var identity = element("div");
    var badges = element("div", "rule-badges");
    badges.appendChild(element("span", "rule-status", rule.status === "active" ? "활성" : rule.status === "approved" ? "Agent 반영 대기" : rule.status === "deprecated" ? "폐기됨" : "승인 대기"));
    badges.appendChild(element("span", "rule-priority", rule.priority));
    badges.appendChild(element("span", "rule-category", rule.category));
    identity.appendChild(badges);
    identity.appendChild(element("h2", null, rule.title));
    identity.appendChild(element("code", null, rule.id));
    head.appendChild(identity);
    var copy = element("button", "rule-copy", "정의 복사");
    copy.type = "button";
    copy.addEventListener("click", function () { copyJson(rule, rule.id + " 규칙 복사됨"); });
    head.appendChild(copy);
    card.appendChild(head);
    card.appendChild(element("p", "rule-statement", rule.statement));
    if (rule.rationale) card.appendChild(element("p", "rule-rationale", rule.rationale));
    var applies = element("div", "rule-applies");
    (rule.appliesTo || []).forEach(function (target) { applies.appendChild(element("span", null, target)); });
    card.appendChild(applies);
    var checks = element("section", "rule-checks");
    checks.appendChild(element("h3", null, "검증 항목"));
    (rule.verification?.checks || []).forEach(function (check) { checks.appendChild(element("p", null, "✓ " + check)); });
    card.appendChild(checks);
    card.appendChild(element("p", "rule-source-label", sourceLabel(rule.source)));
    if (entry.kind === "feedback" && rule.status === "proposed") {
      var actions = element("div", "rule-actions");
      var approve = element("button", "approve", "공통 규칙 승인"); approve.type = "button";
      var reject = element("button", "reject", "후보 폐기"); reject.type = "button";
      approve.addEventListener("click", function () { updateProposal(entry.commentId, "approved"); });
      reject.addEventListener("click", function () { updateProposal(entry.commentId, "rejected"); });
      actions.appendChild(approve); actions.appendChild(reject); card.appendChild(actions);
    }
    card.appendChild(definitionDetails(rule));
    return card;
  }

  function applyFilter(cards) {
    var query = search.value.trim().toLocaleLowerCase();
    var visible = 0;
    cards.forEach(function (card) {
      var show = (activeStatus === "all" || card.dataset.status === activeStatus) && (!query || card.dataset.search.includes(query));
      card.hidden = !show;
      if (show) visible += 1;
    });
    document.querySelector("#rules-empty").hidden = visible !== 0;
  }

  function render() {
    results.innerHTML = "";
    var entries = allEntries();
    var cards = entries.map(ruleCard);
    cards.forEach(function (card) { results.appendChild(card); });
    var active = entries.filter(function (entry) { return entry.value.status === "active"; }).length;
    var proposed = entries.filter(function (entry) { return ["proposed", "approved"].includes(entry.value.status); }).length;
    document.querySelector("#rules-count").textContent = active || proposed ? String(active + proposed) : "";
    document.querySelector("#rules-revision").textContent = rulesData.rulesRevision ? "revision " + rulesData.rulesRevision + " · " + rulesData.scope : "공유 규칙 파일 없음";
    document.querySelector("#rules-description").textContent = rulesData.description || "Agent가 모든 Canvas 작업 전에 읽는 공통 제약과 검증 항목입니다.";
    document.querySelector("#rules-counts").textContent = active + " active · " + proposed + " proposed";
    document.querySelector("#rules-source").textContent = rulesData.source ? "Source · " + rulesData.source : "Source · ../_shared/rules.json을 만들면 자동 연결됩니다.";
    applyFilter(cards);
  }

  nav.addEventListener("click", function (event) {
    var target = event.target.closest("button[data-status]");
    if (!target) return;
    activeStatus = target.dataset.status;
    nav.querySelectorAll("button").forEach(function (item) { item.classList.toggle("on", item === target); });
    applyFilter(Array.from(results.children));
  });
  search.addEventListener("input", function () { applyFilter(Array.from(results.children)); });
  document.querySelector("#rules-copy-active").addEventListener("click", function () {
    copyJson({ rulesRevision: rulesData.rulesRevision, rules: (rulesData.rules || []).filter(function (rule) { return rule.status === "active"; }) }, "활성 규칙 복사됨");
  });

  function setOpen(open) {
    document.body.classList.toggle("rules-on", open);
    view.hidden = !open;
    button.classList.toggle("on", open);
    button.setAttribute("aria-pressed", String(open));
    [document.querySelector("#mode-board"), document.querySelector("#mode-interact")].forEach(function (mode) {
      if (mode) mode.classList.toggle("on", !open && !document.body.classList.contains("library-on") && mode.id === "mode-" + document.body.dataset.mode);
    });
    if (open) {
      document.body.classList.remove("library-on");
      var libraryView = document.querySelector("#library-view");
      var libraryButton = document.querySelector("#library-btn");
      if (libraryView) libraryView.hidden = true;
      if (libraryButton) { libraryButton.classList.remove("on"); libraryButton.setAttribute("aria-pressed", "false"); }
      render();
      requestAnimationFrame(function () { search.focus(); });
    }
  }

  button.addEventListener("click", function () { setOpen(!document.body.classList.contains("rules-on")); });
  ["#mode-board", "#mode-interact", "#frame-picker-trigger", "#notes-btn", "#comment-btn", "#library-btn"].forEach(function (selector) {
    var control = document.querySelector(selector);
    if (control) control.addEventListener("click", function () { setOpen(false); });
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && document.body.classList.contains("rules-on")) setOpen(false);
  });
  render();
})();
