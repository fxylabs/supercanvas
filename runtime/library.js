/* Design Library runtime: searchable foundations, layouts, components and exact definition data. */
(function () {
  "use strict";

  var dataElement = document.querySelector("#canvas-data");
  var data = dataElement ? JSON.parse(dataElement.textContent) : {};
  var library = data.library;
  var button = document.querySelector("#library-btn");
  var view = document.querySelector("#library-view");
  if (!button || !view) return;
  if (!library) {
    button.hidden = true;
    view.hidden = true;
    return;
  }

  var search = document.querySelector("#library-search");
  var nav = document.querySelector("#library-nav");
  var results = document.querySelector("#library-results");
  var activeKind = "all";

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
    setTimeout(function () { toast.classList.remove("show"); }, 2200);
  }

  function copyJson(value, label) {
    var text = JSON.stringify(value, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { announce(label + " 정의 복사됨"); }, function () { announce("복사할 정의를 펼쳐 확인하세요"); });
    } else announce("복사할 정의를 펼쳐 확인하세요");
  }

  function definitionDetails(value) {
    var details = element("details", "library-definition");
    details.appendChild(element("summary", null, "정의 데이터 보기"));
    details.appendChild(element("pre", null, JSON.stringify(value, null, 2)));
    return details;
  }

  function cardHead(kind, id, title, definition) {
    var head = element("header", "library-card-head");
    var copy = element("button", "library-copy", "정의 복사");
    copy.type = "button";
    copy.addEventListener("click", function () { copyJson(definition, id); });
    var identity = element("div");
    identity.appendChild(element("span", "library-kind", kind));
    identity.appendChild(element("h2", null, title));
    identity.appendChild(element("code", null, id));
    head.appendChild(identity);
    head.appendChild(copy);
    return head;
  }

  function flatten(value, prefix, rows) {
    Object.entries(value || {}).forEach(function (entry) {
      var name = prefix ? prefix + "." + entry[0] : entry[0];
      if (entry[1] && typeof entry[1] === "object" && !Array.isArray(entry[1])) flatten(entry[1], name, rows);
      else rows.push([name, String(entry[1])]);
    });
  }

  function foundationCard(foundation) {
    var card = element("article", "library-card library-foundation-card");
    card.dataset.kind = "foundation";
    card.dataset.search = (foundation.id + " " + foundation.title + " " + foundation.description + " " + foundation.kind).toLocaleLowerCase();
    card.appendChild(cardHead(foundation.kind, foundation.id, foundation.title, foundation));
    card.appendChild(element("p", "library-description", foundation.description));
    var rows = [];
    flatten(foundation.resolved, "", rows);
    var values = element("div", "foundation-values " + (foundation.kind === "color" ? "is-color" : ""));
    rows.forEach(function (row) {
      var item = element("div", "foundation-value");
      if (foundation.kind === "color") {
        var swatch = element("span", "foundation-swatch");
        swatch.style.background = row[1];
        item.appendChild(swatch);
      }
      var copy = element("div");
      copy.appendChild(element("strong", null, row[0]));
      copy.appendChild(element("code", null, row[1]));
      if (foundation.kind === "typography") {
        var sample = element("span", "type-sample", "가나다 Typography 0123");
        if (row[0].endsWith("size")) sample.style.fontSize = row[1];
        if (row[0].endsWith("weight")) sample.style.fontWeight = row[1];
        if (row[0].endsWith("lineHeight")) sample.style.lineHeight = row[1];
        item.appendChild(sample);
      }
      item.appendChild(copy);
      values.appendChild(item);
    });
    card.appendChild(values);
    if (foundation.guidance && foundation.guidance.length) card.appendChild(element("p", "library-guidance", foundation.guidance.join(" · ")));
    card.appendChild(definitionDetails(foundation));
    return card;
  }

  function layoutCard(layout) {
    var card = element("article", "library-card library-layout-card");
    card.dataset.kind = "layout";
    card.dataset.search = (layout.id + " " + layout.title + " " + layout.description + " " + Object.keys(layout.properties || {}).join(" ")).toLocaleLowerCase();
    card.appendChild(cardHead("layout", layout.id, layout.title, layout));
    card.appendChild(element("p", "library-description", layout.description));
    var preview = element("div", "library-layout-preview " + layout.className);
    for (var index = 1; index <= 3; index += 1) preview.appendChild(element("span", null, String(index)));
    card.appendChild(preview);
    var props = element("dl", "library-property-list");
    Object.entries(layout.properties || {}).forEach(function (entry) {
      props.appendChild(element("dt", null, entry[0]));
      props.appendChild(element("dd", null, String(entry[1])));
    });
    card.appendChild(props);
    card.appendChild(definitionDetails(layout));
    return card;
  }

  function kebab(value) {
    return value.replace(/[A-Z]/g, function (letter) { return "-" + letter.toLowerCase(); });
  }

  function storyPreview(component, story) {
    var mergedPreview = Object.assign({}, component.preview || {}, story.preview || {});
    var node = document.createElement(mergedPreview.tag || component.contract.element);
    node.className = mergedPreview.className || component.contract.className;
    var attributes = Object.assign({}, component.preview?.attributes || {}, story.preview?.attributes || {});
    Object.entries(attributes).forEach(function (entry) { node.setAttribute(entry[0], String(entry[1])); });
    var props = {};
    Object.entries(component.contract.props || {}).forEach(function (entry) {
      if (entry[1].default != null) props[entry[0]] = entry[1].default;
    });
    Object.assign(props, story.props || {});
    Object.entries(props).forEach(function (entry) {
      if (typeof entry[1] === "boolean") {
        if (entry[1]) node.setAttribute(kebab(entry[0]), "");
      } else node.setAttribute("data-" + kebab(entry[0]), String(entry[1]));
    });
    if (node.tagName === "INPUT" || node.tagName === "TEXTAREA") {
      if (mergedPreview.value != null) node.value = mergedPreview.value;
    } else node.textContent = mergedPreview.text || story.slots?.default || component.name;
    return node;
  }

  function componentCard(component) {
    var card = element("article", "library-card library-component-card");
    card.dataset.kind = "component";
    card.dataset.search = (component.id + " " + component.name + " " + component.description + " " + Object.keys(component.contract.props || {}).join(" ") + " " + (component.contract.states || []).join(" ")).toLocaleLowerCase();
    card.appendChild(cardHead("component", component.id, component.name, component));
    card.appendChild(element("p", "library-description", component.description));
    var contract = element("div", "library-contract");
    ["<" + component.contract.element + ">"].concat(component.contract.states || []).concat(component.contract.events || []).forEach(function (value) {
      contract.appendChild(element("code", null, value));
    });
    card.appendChild(contract);
    var stories = element("div", "library-stories");
    (component.stories || []).forEach(function (story) {
      var item = element("section", "library-story");
      item.dataset.state = story.state || "default";
      var head = element("div", "library-story-head");
      head.appendChild(element("strong", null, story.title));
      head.appendChild(element("code", null, story.id));
      item.appendChild(head);
      var stage = element("div", "library-story-stage");
      stage.appendChild(storyPreview(component, story));
      item.appendChild(stage);
      stories.appendChild(item);
    });
    card.appendChild(stories);
    var split = element("div", "library-guidance-grid");
    var use = element("section"); use.appendChild(element("h3", null, "Use"));
    var avoid = element("section"); avoid.appendChild(element("h3", null, "Avoid"));
    (component.guidance?.use || []).forEach(function (value) { use.appendChild(element("p", null, value)); });
    (component.guidance?.avoid || []).forEach(function (value) { avoid.appendChild(element("p", null, value)); });
    split.appendChild(use); split.appendChild(avoid); card.appendChild(split);
    if (component.accessibility?.length) card.appendChild(element("p", "library-a11y", "Accessibility · " + component.accessibility.join(" · ")));
    card.appendChild(definitionDetails(component));
    return card;
  }

  function allCards() {
    return [].concat(
      (library.foundations || []).map(foundationCard),
      (library.layouts || []).map(layoutCard),
      (library.components || []).map(componentCard)
    );
  }

  var cards = allCards();
  cards.forEach(function (card) { results.appendChild(card); });
  document.querySelector("#library-title").textContent = library.library.title;
  document.querySelector("#library-version").textContent = library.library.version;
  document.querySelector("#library-description").textContent = library.library.description;
  document.querySelector("#library-counts").textContent = library.foundations.length + " foundations · " + library.layouts.length + " layouts · " + library.components.length + " components";

  function applyFilter() {
    var query = search.value.trim().toLocaleLowerCase();
    var visible = 0;
    cards.forEach(function (card) {
      var show = (activeKind === "all" || card.dataset.kind === activeKind) && (!query || card.dataset.search.includes(query));
      card.hidden = !show;
      if (show) visible += 1;
    });
    document.querySelector("#library-empty").hidden = visible !== 0;
  }

  nav.addEventListener("click", function (event) {
    var target = event.target.closest("button[data-kind]");
    if (!target) return;
    activeKind = target.dataset.kind;
    nav.querySelectorAll("button").forEach(function (item) { item.classList.toggle("on", item === target); });
    applyFilter();
  });
  search.addEventListener("input", applyFilter);
  document.querySelector("#library-copy-all").addEventListener("click", function () { copyJson(library, library.library.id); });

  function setOpen(open) {
    document.body.classList.toggle("library-on", open);
    view.hidden = !open;
    button.classList.toggle("on", open);
    button.setAttribute("aria-pressed", String(open));
    [document.querySelector("#mode-board"), document.querySelector("#mode-interact")].forEach(function (mode) {
      if (mode) mode.classList.toggle("on", !open && mode.id === "mode-" + document.body.dataset.mode);
    });
    if (open) requestAnimationFrame(function () { search.focus(); });
  }

  button.addEventListener("click", function () { setOpen(!document.body.classList.contains("library-on")); });
  ["#mode-board", "#mode-interact"].forEach(function (selector) {
    var mode = document.querySelector(selector);
    if (mode) mode.addEventListener("click", function () { setOpen(false); });
  });
  ["#frame-picker-trigger", "#notes-btn", "#comment-btn", "#rules-btn"].forEach(function (selector) {
    var control = document.querySelector(selector);
    if (control) control.addEventListener("click", function () { setOpen(false); });
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && document.body.classList.contains("library-on")) setOpen(false);
  });
})();
