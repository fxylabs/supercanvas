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
      navigator.clipboard.writeText(text).then(function () { announce(message); }, function () { announce("Expand the definition data and copy it manually."); });
    } else announce("Expand the definition data and copy it manually.");
  }

  function sourceLabel(source) {
    if (!source) return "No source";
    var labels = { "user-instruction": "User instruction", feedback: "Comment feedback", "agent-proposal": "Agent proposal", maintainer: "Maintainer" };
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
          title: proposal.title || "Common rule found in a comment",
          status: proposal.status,
          priority: proposal.priority || "should",
          category: proposal.category,
          statement: proposal.statement,
          rationale: proposal.rationale || "This comment may apply repeatedly across multiple frames or canvases.",
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
    announce(status === "approved" ? "Rule candidate approved. The agent promotes it to a common rule after you save feedback." : "Rule candidate dropped.");
  }

  function definitionDetails(value) {
    var details = element("details", "rules-definition");
    details.appendChild(element("summary", null, "View definition data"));
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
    badges.appendChild(element("span", "rule-status", rule.status === "active" ? "Active" : rule.status === "approved" ? "Awaiting agent" : rule.status === "deprecated" ? "Deprecated" : "Pending approval"));
    badges.appendChild(element("span", "rule-priority", rule.priority));
    badges.appendChild(element("span", "rule-category", rule.category));
    identity.appendChild(badges);
    identity.appendChild(element("h2", null, rule.title));
    identity.appendChild(element("code", null, rule.id));
    head.appendChild(identity);
    var copy = element("button", "rule-copy", "Copy definition");
    copy.type = "button";
    copy.addEventListener("click", function () { copyJson(rule, rule.id + " rule copied"); });
    head.appendChild(copy);
    card.appendChild(head);
    card.appendChild(element("p", "rule-statement", rule.statement));
    if (rule.rationale) card.appendChild(element("p", "rule-rationale", rule.rationale));
    var applies = element("div", "rule-applies");
    (rule.appliesTo || []).forEach(function (target) { applies.appendChild(element("span", null, target)); });
    card.appendChild(applies);
    var checks = element("section", "rule-checks");
    checks.appendChild(element("h3", null, "Verification checks"));
    (rule.verification?.checks || []).forEach(function (check) { checks.appendChild(element("p", null, "✓ " + check)); });
    card.appendChild(checks);
    card.appendChild(element("p", "rule-source-label", sourceLabel(rule.source)));
    if (entry.kind === "feedback" && rule.status === "proposed") {
      var actions = element("div", "rule-actions");
      var approve = element("button", "approve", "Approve common rule"); approve.type = "button";
      var reject = element("button", "reject", "Drop candidate"); reject.type = "button";
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
    document.querySelector("#rules-revision").textContent = rulesData.rulesRevision ? "revision " + rulesData.rulesRevision + " · " + rulesData.scope : "No shared rules file";
    document.querySelector("#rules-description").textContent = rulesData.description || "Common constraints and verification checks the agent reads before every canvas change.";
    document.querySelector("#rules-counts").textContent = active + " active · " + proposed + " proposed";
    document.querySelector("#rules-source").textContent = rulesData.source ? "Source · " + rulesData.source : "Source · create ../_shared/rules.json to link it automatically.";
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
    copyJson({ rulesRevision: rulesData.rulesRevision, rules: (rulesData.rules || []).filter(function (rule) { return rule.status === "active"; }) }, "Active rules copied");
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
