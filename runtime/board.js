/* Canvas Review runtime: board navigation, executable HTML frames and portable feedback. */
(function () {
  "use strict";

  var qs = function (selector, root) { return (root || document).querySelector(selector); };
  var qsa = function (selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); };
  var data = JSON.parse(qs("#canvas-data").textContent);
  var canvasMeta = data.canvas;
  var revision = data.revision || { id: canvasMeta.version, targetHashes: {} };
  var frames = data.frames || [];
  var groups = data.groups || [];
  var connections = data.connections || [];
  var actions = data.actions || [];
  var presetNotes = data.notes || [];
  var feedbackMeta = data.feedback || {};
  var canonicalFeedback = Array.isArray(feedbackMeta.comments) ? feedbackMeta.comments : [];
  var reviewCycle = feedbackMeta.review || { id: "review-legacy", status: "active" };
  var feedbackRevision = Number(feedbackMeta.feedbackRevision) || 1;
  var feedbackProtocol = CanvasFeedback;
  /* Injected by `supercanvas view`. Its presence is what turns Save feedback into a single write
     into the package's feedback.json — a canvas opened straight from disk has no such endpoint. */
  var reviewServer = window.__SUPERCANVAS_SERVER__ || null;
  var canvas = qs("#canvas");
  var world = qs("#world");
  var tabs = qs("#frame-tabs");
  var storeKey = "canvas-feedback-draft:" + canvasMeta.id + ":" + reviewCycle.id;
  var completedKey = "canvas-review-completed:" + canvasMeta.id + ":" + reviewCycle.id;
  var frameById = {};
  var actionById = {};
  var connectionById = {};
  var connectionPoints = {};
  var noteCardById = {};
  var noteBadgeById = {};
  var baseWorldSize = { width: 1, height: 1 };
  var selected = null;
  var activeActionId = null;
  var toastTimer;
  var transitionTimer;
  var scrollTimers = {};
  var modalReturnFocus = null;
  var regionDrag = null;
  var suppressRegionClick = false;

  frames.forEach(function (frame) {
    if (frameById[frame.id]) throw new Error("Duplicate frame ID: " + frame.id);
    frameById[frame.id] = frame;
  });
  actions.forEach(function (action) { actionById[action.id] = action; });
  connections.forEach(function (connection) { connectionById[connection.id] = connection; });

  document.documentElement.lang = canvasMeta.language || "en";
  qs("#canvas-title").textContent = canvasMeta.title;
  qs("#ver-badge").textContent = canvasMeta.version;
  qs("#ver-badge").title = revision.id;

  function toast(message) {
    var element = qs("#toast");
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { element.classList.remove("show"); }, 2600);
  }

  function copyText(value, message) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(function () { toast(message); }, function () { toast(value); });
    } else toast(value);
  }

  function renderFrames() {
    var layout = data.layout || {};
    var padding = Number(layout.padding) || 80;
    var gap = Number(layout.gap) || 120;
    var cursorX = padding;
    var maxRight = 0;
    var maxBottom = 0;

    frames.forEach(function (frame) {
      var x = frame.x == null ? cursorX : frame.x;
      var y = frame.y == null ? padding : frame.y;
      var section = document.createElement("section");
      section.className = "flow-step" + (frame.invalid ? " invalid" : "");
      section.dataset.frameId = frame.id;
      section.dataset.title = frame.title;
      section.style.left = x + "px";
      section.style.top = y + "px";
      section.tabIndex = 0;
      section.setAttribute("role", "group");
      section.setAttribute("aria-label", frame.title + " frame. Press Enter to run it.");

      var head = document.createElement("div");
      head.className = "step-head";
      head.appendChild(document.createTextNode(frame.title));
      var id = document.createElement("button");
      id.type = "button";
      id.className = "step-id";
      id.textContent = "#" + frame.id;
      id.title = "Copy frame ID";
      id.addEventListener("click", function (event) {
        event.stopPropagation();
        copyText("#" + frame.id, "Frame ID copied — #" + frame.id);
      });
      head.appendChild(id);

      var device = document.createElement("div");
      device.className = "device";
      device.style.width = frame.width + "px";
      device.style.height = frame.height + "px";
      var content = document.createElement("div");
      content.className = "device-content";
      content.innerHTML = frame.content;
      device.appendChild(content);
      section.appendChild(head);
      section.appendChild(device);
      world.appendChild(section);

      section.addEventListener("focus", function () { if (document.body.dataset.mode === "board") selectTarget("frame", frame.id); });
      section.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && document.body.dataset.mode === "board") {
          event.preventDefault();
          activate(frame.id, true);
          setMode("interact");
        }
      });

      var tab = document.createElement("button");
      tab.type = "button";
      tab.dataset.frameId = frame.id;
      tab.dataset.search = (frame.title + " " + frame.id + " " + frame.summary + " " + (frame.tags || []).join(" ")).toLocaleLowerCase();
      tab.setAttribute("role", "option");
      tab.setAttribute("aria-selected", "false");
      var tabTitle = document.createElement("strong"); tabTitle.textContent = frame.title;
      var tabId = document.createElement("code"); tabId.textContent = frame.id;
      var tabSummary = document.createElement("small"); tabSummary.textContent = frame.summary;
      tab.appendChild(tabTitle); tab.appendChild(tabId); tab.appendChild(tabSummary);
      tab.addEventListener("click", function () { activate(frame.id, true); closeFramePicker(); });
      tabs.appendChild(tab);

      cursorX = x + frame.width + gap;
      maxRight = Math.max(maxRight, x + frame.width);
      maxBottom = Math.max(maxBottom, y + frame.height + 32);
    });

    world.style.width = (maxRight + padding) + "px";
    world.style.height = (maxBottom + padding) + "px";
  }

  renderFrames();
  var steps = qsa(".flow-step", world);
  baseWorldSize = { width: parseFloat(world.style.width) || 1, height: parseFloat(world.style.height) || 1 };

  var framePickerTrigger = qs("#frame-picker-trigger");
  var framePickerPanel = qs("#frame-picker-panel");
  var frameSearch = qs("#frame-search");

  function visibleFrameOptions() {
    return qsa("button", tabs).filter(function (button) { return !button.hidden; });
  }

  function openFramePicker() {
    framePickerPanel.hidden = false;
    framePickerTrigger.setAttribute("aria-expanded", "true");
    frameSearch.value = "";
    qsa("button", tabs).forEach(function (button) { button.hidden = false; });
    qs("#frame-search-empty").hidden = true;
    requestAnimationFrame(function () { frameSearch.focus(); });
  }

  function closeFramePicker() {
    framePickerPanel.hidden = true;
    framePickerTrigger.setAttribute("aria-expanded", "false");
  }

  framePickerTrigger.addEventListener("click", function () {
    if (framePickerPanel.hidden) openFramePicker();
    else closeFramePicker();
  });

  frameSearch.addEventListener("input", function () {
    var query = this.value.trim().toLocaleLowerCase();
    var matches = 0;
    qsa("button", tabs).forEach(function (button) {
      button.hidden = !!query && !button.dataset.search.includes(query);
      if (!button.hidden) matches += 1;
    });
    qs("#frame-search-empty").hidden = matches !== 0;
  });

  frameSearch.addEventListener("keydown", function (event) {
    if (event.key === "ArrowDown") {
      var first = visibleFrameOptions()[0];
      if (first) { event.preventDefault(); first.focus(); }
    }
  });

  tabs.addEventListener("keydown", function (event) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    var options = visibleFrameOptions();
    var current = options.indexOf(document.activeElement);
    var next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : event.key === "ArrowDown" ? Math.min(options.length - 1, current + 1) : Math.max(0, current - 1);
    if (options[next]) { event.preventDefault(); options[next].focus(); }
  });

  function stepFor(id) {
    return steps.filter(function (step) { return step.dataset.frameId === id; })[0];
  }

  function renderGroups() {
    groups.forEach(function (group) {
      var members = (group.members || []).map(stepFor).filter(Boolean);
      if (!members.length) return;
      var left = Math.min.apply(null, members.map(function (step) { return step.offsetLeft; })) - 30;
      var top = Math.min.apply(null, members.map(function (step) { return step.offsetTop; })) - 38;
      var right = Math.max.apply(null, members.map(function (step) { return step.offsetLeft + step.offsetWidth; })) + 30;
      var bottom = Math.max.apply(null, members.map(function (step) { return step.offsetTop + step.offsetHeight; })) + 30;
      var element = document.createElement("section");
      element.className = "canvas-group";
      element.dataset.groupId = group.id;
      element.style.left = left + "px";
      element.style.top = top + "px";
      element.style.width = (right - left) + "px";
      element.style.height = (bottom - top) + "px";
      var label = document.createElement("button");
      label.type = "button";
      label.className = "canvas-group-label";
      label.textContent = group.title;
      label.addEventListener("click", function (event) {
        if (document.body.classList.contains("comment-on")) {
          event.preventDefault();
          openNewPopover({ type: "group", id: group.id }, event.clientX, event.clientY);
        } else selectTarget("group", group.id);
      });
      element.appendChild(label);
      world.insertBefore(element, world.firstChild);
    });
  }

  renderGroups();

  function ownerFrameForNote(note) {
    if (!note.target) return null;
    if (note.target.type === "frame") return note.target.id;
    if (note.target.type === "action") return actionById[note.target.id]?.from.frameId || null;
    if (note.target.type === "connection") return connectionById[note.target.id]?.from || null;
    if (note.target.type === "group") {
      var group = groups.find(function (item) { return item.id === note.target.id; });
      return group && group.members && group.members[0];
    }
    return frames[0]?.id || null;
  }

  function buildPlanningNoteCards() {
    var counts = {};
    presetNotes.forEach(function (note, index) {
      var ownerId = ownerFrameForNote(note);
      var step = stepFor(ownerId) || steps[0];
      if (!step) return;
      var order = counts[ownerId] || 0;
      counts[ownerId] = order + 1;
      var card = document.createElement("article");
      card.className = "planning-note-card";
      card.dataset.noteId = note.id;
      card.tabIndex = 0;
      card.setAttribute("aria-label", "Planning note N" + (index + 1) + ": " + (note.title || note.id));
      card.style.left = (step.offsetLeft + (order % 3) * 294) + "px";
      card.style.top = (step.offsetTop + step.offsetHeight + 66 + Math.floor(order / 3) * 190) + "px";
      var head = document.createElement("div"); head.className = "planning-note-head";
      var number = document.createElement("strong"); number.className = "planning-note-number"; number.textContent = "N" + (index + 1);
      var kind = document.createElement("span"); kind.className = "note-kind"; kind.textContent = note.kind || "note";
      var title = document.createElement("h3"); title.textContent = note.title || note.id;
      var text = document.createElement("p"); text.textContent = note.text;
      var id = document.createElement("code"); id.textContent = "#" + note.id;
      head.appendChild(number); head.appendChild(kind);
      card.appendChild(head); card.appendChild(title); card.appendChild(text); card.appendChild(id);
      card.addEventListener("click", function () { focusPlanningNote(note.id); });
      card.addEventListener("focus", function () { highlightPlanningNote(note.id); });
      world.appendChild(card);
      noteCardById[note.id] = card;
    });
  }

  buildPlanningNoteCards();

  var pz = PZCanvas({
    viewport: canvas,
    world: world,
    minScale: 0.1,
    maxScale: 3,
    captureOnPointerDown: function (event) {
      return document.body.classList.contains("comment-on") && !event.target.closest(".device, .cn-hit");
    },
    dblclickFit: function (event) { return document.body.dataset.mode === "board" && !event.target.closest(".device"); },
    shouldIgnore: function (target) {
      return !!(target.closest("#zoom-hud, #popover, #action-inspector, .pin, .comment-region, .comment-region-draft, .step-id, .canvas-group-label, .planning-note-card, .planning-note-anchor") ||
        (document.body.classList.contains("comment-on") && target.closest(".device")) ||
        (document.body.dataset.mode === "interact" && target.closest(".device")));
    },
    shouldIgnoreWheel: function (target) {
      return !!(target.closest("#zoom-hud, #popover, #action-inspector") ||
        (document.body.dataset.mode === "interact" && target.closest(".device")));
    },
    onChange: function (view) {
      world.style.setProperty("--pin-inv", 1 / view.s);
      qs("#zoom-pct").textContent = Math.round(view.s * 100) + "%";
    }
  });

  qs("#zoom-in").onclick = function () { pz.animate(); pz.zoomBy(1.25); };
  qs("#zoom-out").onclick = function () { pz.animate(); pz.zoomBy(0.8); };
  qs("#zoom-fit").onclick = function () { pz.animate(); pz.fit(); };
  qs("#zoom-100").onclick = function () { pz.animate(); pz.zoomTo(1); };

  function clearSelection() {
    qsa(".selected-target", world).forEach(function (element) { element.classList.remove("selected-target"); });
  }

  function selectTarget(type, id) {
    selected = { type: type, id: id };
    clearSelection();
    var element = type === "frame" ? stepFor(id) : type === "group" ? qs('[data-group-id="' + id + '"]', world) : type === "connection" ? qs('[data-connection-id="' + id + '"]', world) : null;
    if (element) element.classList.add("selected-target");
    if (type === "connection") {
      var line = qs('[data-line-id="' + id + '"]', world);
      if (line) line.classList.add("selected-target");
    }
  }

  function activate(id, focusView) {
    var step = stepFor(id);
    if (!step) return;
    steps.forEach(function (item) { item.classList.toggle("active", item === step); });
    qsa("button", tabs).forEach(function (button) {
      var current = button.dataset.frameId === id;
      button.classList.toggle("on", current);
      button.setAttribute("aria-selected", String(current));
    });
    qs("#frame-picker-value").textContent = frameById[id].title;
    selectTarget("frame", id);
    if (document.body.dataset.mode === "interact" || focusView) {
      requestAnimationFrame(function () {
        pz.animate();
        var fitScale = Math.min(1, (canvas.clientHeight - 70) / step.offsetHeight, (canvas.clientWidth - 70) / step.offsetWidth);
        pz.centerOn(step, fitScale);
      });
    }
  }

  function setMode(mode, options) {
    options = options || {};
    if (mode === "interact" && document.body.classList.contains("notes-on")) {
      document.body.classList.remove("notes-on");
      qs("#notes-btn").classList.remove("on");
      qs("#notes-btn").setAttribute("aria-pressed", "false");
      renderPlanningNotes();
    }
    document.body.dataset.mode = mode;
    var boardButton = qs("#mode-board");
    var interactButton = qs("#mode-interact");
    boardButton.classList.toggle("on", mode === "board");
    interactButton.classList.toggle("on", mode === "interact");
    boardButton.setAttribute("aria-pressed", String(mode === "board"));
    interactButton.setAttribute("aria-pressed", String(mode === "interact"));
    var active = steps.filter(function (step) { return step.classList.contains("active"); })[0] || steps[0];
    qs("#mode-hint").textContent = mode === "board"
      ? "Board review · select a frame and press Enter to run it."
      : "Run mode · try scroll, hover and click inside the frame. Press Esc to go back to the board.";
    requestAnimationFrame(function () {
      pz.animate();
      if (mode === "board") {
        drawConnectors();
        if (activeActionId && actionById[activeActionId]) highlightAction(actionById[activeActionId]);
        renderPlanningNotes();
        if (!options.preserveViewport) pz.fit();
      }
      else if (active) {
        activate(active.dataset.frameId, true);
        var first = qs("button, input, [tabindex]", qs(".device-content", active));
        if (first) first.focus({ preventScroll: true });
      }
      renderPins();
    });
  }

  qs("#mode-board").onclick = function () { setMode("board"); };
  qs("#mode-interact").onclick = function () { setMode("interact"); };

  var fileMenuTrigger = qs("#file-menu-trigger");
  var fileMenuPanel = qs("#file-menu-panel");
  function closeFileMenu() {
    fileMenuPanel.hidden = true;
    fileMenuTrigger.setAttribute("aria-expanded", "false");
  }
  fileMenuTrigger.addEventListener("click", function () {
    var open = fileMenuPanel.hidden;
    fileMenuPanel.hidden = !open;
    fileMenuTrigger.setAttribute("aria-expanded", String(open));
    if (open) requestAnimationFrame(function () { qs("button", fileMenuPanel).focus(); });
  });
  fileMenuPanel.addEventListener("keydown", function (event) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    var items = qsa('[role="menuitem"]', fileMenuPanel);
    var current = items.indexOf(document.activeElement);
    var next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? Math.min(items.length - 1, current + 1) : Math.max(0, current - 1);
    if (items[next]) { event.preventDefault(); items[next].focus(); }
  });
  document.addEventListener("click", function (event) {
    if (!event.target.closest(".frame-picker")) closeFramePicker();
    if (!event.target.closest(".file-menu")) closeFileMenu();
  });

  canvas.addEventListener("click", function (event) {
    if (document.body.dataset.mode !== "board" || event.target.closest(".pin, .comment-region, .step-id, .canvas-group-label, .cn-hit")) return;
    var device = event.target.closest(".device");
    if (device) {
      event.preventDefault();
      event.stopPropagation();
      selectTarget("frame", device.closest(".flow-step").dataset.frameId);
    } else if (event.target === canvas || event.target === world) selectTarget("canvas", canvasMeta.id);
  }, true);

  canvas.addEventListener("dblclick", function (event) {
    if (document.body.dataset.mode !== "board") return;
    var device = event.target.closest(".device");
    if (!device) return;
    event.preventDefault();
    event.stopPropagation();
    activate(device.closest(".flow-step").dataset.frameId, true);
    setMode("interact");
  }, true);

  function framePercent(device, clientX, clientY) {
    var rect = device.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, (clientX - rect.left) / rect.width * 100)),
      y: Math.max(0, Math.min(100, (clientY - rect.top) / rect.height * 100))
    };
  }

  canvas.addEventListener("pointerdown", function (event) {
    if (event.button !== 0 || !document.body.classList.contains("comment-on") || event.target.closest(".pin, .comment-region, #popover")) return;
    var device = event.target.closest(".device");
    if (!device) return;
    var start = framePercent(device, event.clientX, event.clientY);
    var draft = document.createElement("div");
    draft.className = "comment-region-draft";
    draft.style.left = start.x + "%";
    draft.style.top = start.y + "%";
    device.appendChild(draft);
    regionDrag = {
      pointerId: event.pointerId,
      device: device,
      frameId: device.closest(".flow-step").dataset.frameId,
      clientX: event.clientX,
      clientY: event.clientY,
      start: start,
      current: start,
      draft: draft,
      moved: false,
      captured: false
    };
  }, true);

  canvas.addEventListener("pointermove", function (event) {
    if (!regionDrag || regionDrag.pointerId !== event.pointerId) return;
    regionDrag.current = framePercent(regionDrag.device, event.clientX, event.clientY);
    if (!regionDrag.moved && Math.abs(event.clientX - regionDrag.clientX) + Math.abs(event.clientY - regionDrag.clientY) > 8) {
      regionDrag.moved = true;
      canvas.setPointerCapture(event.pointerId);
      regionDrag.captured = true;
    }
    if (!regionDrag.moved) return;
    event.preventDefault();
    var left = Math.min(regionDrag.start.x, regionDrag.current.x);
    var top = Math.min(regionDrag.start.y, regionDrag.current.y);
    var width = Math.abs(regionDrag.current.x - regionDrag.start.x);
    var height = Math.abs(regionDrag.current.y - regionDrag.start.y);
    regionDrag.draft.style.left = left + "%";
    regionDrag.draft.style.top = top + "%";
    regionDrag.draft.style.width = width + "%";
    regionDrag.draft.style.height = height + "%";
  }, true);

  function finishRegionDrag(event) {
    if (!regionDrag || regionDrag.pointerId !== event.pointerId) return;
    var drag = regionDrag;
    regionDrag = null;
    if (drag.captured && canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    drag.draft.remove();
    if (!drag.moved) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressRegionClick = true;
    setTimeout(function () { suppressRegionClick = false; }, 0);
    var left = Math.round(Math.min(drag.start.x, drag.current.x) * 10) / 10;
    var top = Math.round(Math.min(drag.start.y, drag.current.y) * 10) / 10;
    var width = Math.round(Math.abs(drag.current.x - drag.start.x) * 10) / 10;
    var height = Math.round(Math.abs(drag.current.y - drag.start.y) * 10) / 10;
    openNewPopover({
      type: "frame",
      id: drag.frameId,
      anchor: { kind: "region", x: left, y: top, width: width, height: height }
    }, event.clientX, event.clientY);
  }

  canvas.addEventListener("pointerup", finishRegionDrag, true);
  canvas.addEventListener("pointercancel", function (event) {
    if (!regionDrag || regionDrag.pointerId !== event.pointerId) return;
    regionDrag.draft.remove();
    regionDrag = null;
  }, true);

  function worldRect(element) {
    var elementRect = element.getBoundingClientRect();
    var worldBounds = world.getBoundingClientRect();
    var scale = pz.view.s || 1;
    return {
      x: (elementRect.left - worldBounds.left) / scale,
      y: (elementRect.top - worldBounds.top) / scale,
      width: elementRect.width / scale,
      height: elementRect.height / scale
    };
  }

  function portPoint(element, port) {
    var rect = worldRect(element);
    if (port === "top") return { x: rect.x + rect.width / 2, y: rect.y };
    if (port === "bottom") return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
    if (port === "left") return { x: rect.x, y: rect.y + rect.height / 2 };
    return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
  }

  function anchorElement(anchor, fallbackFrameId) {
    if (anchor && anchor.type === "action") return qs('[data-action="' + anchor.id + '"]', world);
    var step = stepFor(anchor && anchor.type === "frame" ? anchor.id : fallbackFrameId);
    return step ? qs(".device", step) : null;
  }

  function routedPoints(start, end, fromPort, toPort, lane) {
    var offset = Number(lane) || 0;
    var points = [start];
    var fromVertical = fromPort === "top" || fromPort === "bottom";
    var toVertical = toPort === "top" || toPort === "bottom";
    if (!fromVertical && !toVertical && fromPort !== toPort) {
      var middleX = (start.x + end.x) / 2 + offset * 28;
      points.push({ x: middleX, y: start.y }, { x: middleX, y: end.y });
    } else if (fromVertical && toVertical && fromPort === toPort) {
      var outsideY = fromPort === "top"
        ? Math.min(start.y, end.y) - 54 - Math.abs(offset) * 30
        : Math.max(start.y, end.y) + 54 + Math.abs(offset) * 30;
      points.push({ x: start.x, y: outsideY }, { x: end.x, y: outsideY });
    } else if (!fromVertical && !toVertical) {
      var outsideX = fromPort === "left"
        ? Math.min(start.x, end.x) - 54 - Math.abs(offset) * 30
        : Math.max(start.x, end.x) + 54 + Math.abs(offset) * 30;
      points.push({ x: outsideX, y: start.y }, { x: outsideX, y: end.y });
    } else {
      var fromVector = fromPort === "top" ? { x: 0, y: -1 } : fromPort === "bottom" ? { x: 0, y: 1 } : fromPort === "left" ? { x: -1, y: 0 } : { x: 1, y: 0 };
      var toVector = toPort === "top" ? { x: 0, y: -1 } : toPort === "bottom" ? { x: 0, y: 1 } : toPort === "left" ? { x: -1, y: 0 } : { x: 1, y: 0 };
      var startStub = { x: start.x + fromVector.x * (28 + Math.abs(offset) * 12), y: start.y + fromVector.y * (28 + Math.abs(offset) * 12) };
      var endStub = { x: end.x + toVector.x * 28, y: end.y + toVector.y * 28 };
      points.push(startStub);
      points.push(fromVertical ? { x: startStub.x, y: endStub.y } : { x: endStub.x, y: startStub.y });
      points.push(endStub);
    }
    points.push(end);
    return points.filter(function (point, index, list) { return index === 0 || point.x !== list[index - 1].x || point.y !== list[index - 1].y; });
  }

  function pathFor(points) {
    return points.map(function (point, index) { return (index ? " L" : "M") + Math.round(point.x * 10) / 10 + " " + Math.round(point.y * 10) / 10; }).join("");
  }

  function arrowFor(points) {
    var end = points[points.length - 1];
    var previous = points[points.length - 2];
    var dx = end.x - previous.x;
    var dy = end.y - previous.y;
    var length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    var ux = dx / length;
    var uy = dy / length;
    var px = -uy;
    var py = ux;
    return "M" + end.x + " " + end.y + " L" + (end.x - ux * 11 + px * 5.5) + " " + (end.y - uy * 11 + py * 5.5) + " L" + (end.x - ux * 11 - px * 5.5) + " " + (end.y - uy * 11 - py * 5.5) + " Z";
  }

  function labelPointFor(points) {
    var longest = { length: -1, start: points[0], end: points[points.length - 1] };
    for (var index = 1; index < points.length; index += 1) {
      var start = points[index - 1];
      var end = points[index];
      var length = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
      if (length > longest.length) longest = { length: length, start: start, end: end };
    }
    return { x: (longest.start.x + longest.end.x) / 2, y: (longest.start.y + longest.end.y) / 2 };
  }

  function drawConnectors() {
    var old = qs("#flow-connectors", world);
    if (old) old.remove();
    qsa(".cn-label", world).forEach(function (label) { label.remove(); });
    var namespace = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(namespace, "svg");
    svg.id = "flow-connectors";
    svg.setAttribute("width", world.offsetWidth);
    svg.setAttribute("height", world.offsetHeight);
    connectionPoints = {};

    connections.forEach(function (connection) {
      var from = stepFor(connection.from);
      var to = stepFor(connection.to);
      if (!from || !to) return;
      var route = connection.route || {
        type: "orthogonal",
        from: { type: "frame", id: connection.from, port: connection.to === connection.from ? "bottom" : "right" },
        to: { type: "frame", id: connection.to, port: connection.to === connection.from ? "top" : "left" },
        lane: 0
      };
      var fromElement = anchorElement(route.from, connection.from);
      var toElement = anchorElement(route.to, connection.to);
      if (!fromElement || !toElement) return;
      var start = portPoint(fromElement, route.from.port || "right");
      var end = portPoint(toElement, route.to.port || "left");
      var points = routedPoints(start, end, route.from.port || "right", route.to.port || "left", route.lane);
      var pathData = pathFor(points);
      var path = document.createElementNS(namespace, "path");
      path.setAttribute("class", "cn-line" + (connection.kind === "branch" ? " branch" : ""));
      path.setAttribute("data-line-id", connection.id);
      path.setAttribute("d", pathData);
      svg.appendChild(path);
      var hit = document.createElementNS(namespace, "path");
      hit.setAttribute("class", "cn-hit");
      hit.setAttribute("data-connection-id", connection.id);
      hit.setAttribute("d", pathData);
      hit.setAttribute("tabindex", "0");
      hit.setAttribute("role", "button");
      hit.setAttribute("aria-label", (connection.label || "Connection") + " #" + connection.id);
      hit.addEventListener("focus", function () { selectTarget("connection", connection.id); });
      hit.addEventListener("click", function (event) {
        if (document.body.classList.contains("comment-on")) return;
        event.stopPropagation();
        selectTarget("connection", connection.id);
      });
      svg.appendChild(hit);
      var labelPoint = labelPointFor(points);
      connectionPoints[connection.id] = { x: labelPoint.x, y: labelPoint.y };
      var dot = document.createElementNS(namespace, "circle");
      dot.setAttribute("class", "cn-end"); dot.setAttribute("cx", start.x); dot.setAttribute("cy", start.y); dot.setAttribute("r", 3.5); svg.appendChild(dot);
      var head = document.createElementNS(namespace, "path");
      head.setAttribute("class", "cn-end");
      head.setAttribute("d", arrowFor(points));
      svg.appendChild(head);
      if (connection.label) {
        var label = document.createElement("span");
        label.className = "cn-label";
        label.textContent = connection.label;
        label.style.left = labelPoint.x + "px";
        label.style.top = (labelPoint.y - 16) + "px";
        world.appendChild(label);
      }
    });
    world.appendChild(svg);
  }

  function notesFor(type, id) {
    return presetNotes.filter(function (note) { return note.target && note.target.type === type && note.target.id === id; });
  }

  function noteTargetPoint(note) {
    if (note.target.type === "action") {
      var actionElement = qs('[data-action="' + note.target.id + '"]', world);
      if (!actionElement) return null;
      var actionRect = worldRect(actionElement);
      return { x: actionRect.x + actionRect.width, y: actionRect.y + actionRect.height / 2, element: actionElement };
    }
    if (note.target.type === "frame") {
      var step = stepFor(note.target.id);
      var device = step && qs(".device", step);
      if (!device) return null;
      var frameRect = worldRect(device);
      return {
        x: frameRect.x + frameRect.width * ((note.target.x == null ? 50 : note.target.x) / 100),
        y: frameRect.y + frameRect.height * ((note.target.y == null ? 8 : note.target.y) / 100),
        element: device
      };
    }
    if (note.target.type === "connection" && connectionPoints[note.target.id]) return { x: connectionPoints[note.target.id].x, y: connectionPoints[note.target.id].y, element: qs('[data-connection-id="' + note.target.id + '"]', world) };
    if (note.target.type === "group") {
      var group = qs('[data-group-id="' + note.target.id + '"]', world);
      if (!group) return null;
      var groupRect = worldRect(group);
      return { x: groupRect.x + 18, y: groupRect.y + 18, element: group };
    }
    return { x: 28, y: 28, element: world };
  }

  function highlightPlanningNote(noteId) {
    qsa(".planning-note-active", world).forEach(function (element) { element.classList.remove("planning-note-active"); });
    var card = noteCardById[noteId];
    var badge = noteBadgeById[noteId];
    var link = qs('[data-note-link="' + noteId + '"]', world);
    var note = presetNotes.find(function (item) { return item.id === noteId; });
    var target = note && noteTargetPoint(note);
    if (card) card.classList.add("planning-note-active");
    if (badge) badge.classList.add("planning-note-active");
    if (link) link.classList.add("planning-note-active");
    if (target && target.element) target.element.classList.add("planning-note-active");
  }

  function focusPlanningNote(noteId) {
    var card = noteCardById[noteId];
    if (!card) return;
    highlightPlanningNote(noteId);
    pz.animate();
    pz.centerOn(card, Math.min(1, Math.max(.55, pz.view.s)));
    requestAnimationFrame(function () { card.focus({ preventScroll: true }); });
  }

  function renderPlanningNotes() {
    var previous = qs("#note-connectors", world);
    if (previous) previous.remove();
    qsa(".planning-note-anchor", world).forEach(function (element) { element.remove(); });
    qsa(".planning-note-target, .planning-note-active", world).forEach(function (element) { element.classList.remove("planning-note-target", "planning-note-active"); });
    noteBadgeById = {};
    world.style.width = baseWorldSize.width + "px";
    world.style.height = baseWorldSize.height + "px";
    if (!document.body.classList.contains("notes-on")) return;

    var maxRight = baseWorldSize.width;
    var maxBottom = baseWorldSize.height;
    Object.values(noteCardById).forEach(function (card) {
      maxRight = Math.max(maxRight, card.offsetLeft + card.offsetWidth + 48);
      maxBottom = Math.max(maxBottom, card.offsetTop + card.offsetHeight + 48);
    });
    world.style.width = maxRight + "px";
    world.style.height = maxBottom + "px";

    var namespace = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(namespace, "svg");
    svg.id = "note-connectors";
    svg.setAttribute("width", world.offsetWidth);
    svg.setAttribute("height", world.offsetHeight);

    presetNotes.forEach(function (note, index) {
      var target = noteTargetPoint(note);
      var card = noteCardById[note.id];
      if (!target || !card) return;
      if (target.element) target.element.classList.add("planning-note-target");
      var badge = document.createElement("button");
      badge.type = "button";
      badge.className = "planning-note-anchor";
      badge.dataset.noteId = note.id;
      badge.style.left = target.x + "px";
      badge.style.top = target.y + "px";
      badge.textContent = "N" + (index + 1);
      badge.setAttribute("aria-label", "Go to planning note N" + (index + 1));
      badge.addEventListener("click", function (event) { event.stopPropagation(); focusPlanningNote(note.id); });
      world.appendChild(badge);
      noteBadgeById[note.id] = badge;

      var end = portPoint(card, "top");
      var points = routedPoints(target, end, "bottom", "top", index % 3);
      var line = document.createElementNS(namespace, "path");
      line.setAttribute("class", "note-link");
      line.setAttribute("data-note-link", note.id);
      line.setAttribute("d", pathFor(points));
      svg.appendChild(line);
    });
    world.appendChild(svg);
  }

  document.addEventListener("click", function (event) {
    if (!document.body.classList.contains("notes-on") || event.target.closest(".planning-note-card, .planning-note-anchor")) return;
    var actionElement = event.target.closest("[data-action]");
    var matches = actionElement ? notesFor("action", actionElement.dataset.action) : [];
    if (!matches.length) {
      var device = event.target.closest(".device");
      if (device) matches = notesFor("frame", device.closest(".flow-step").dataset.frameId);
    }
    if (!matches.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    focusPlanningNote(matches[0].id);
  }, true);

  function showActionInspector(action) {
    var inspector = qs("#action-inspector");
    var noteList = notesFor("action", action.id);
    qs("#action-inspector-title").textContent = action.label || action.id;
    qs("#action-inspector-id").textContent = "#" + action.id + " · " + action.trigger;
    var root = qs("#action-inspector-notes");
    root.innerHTML = "";
    if (!noteList.length) {
      var empty = document.createElement("p");
      empty.className = "inspector-empty";
      empty.textContent = "No planning notes linked to this action.";
      root.appendChild(empty);
    }
    noteList.forEach(function (note) {
      var article = document.createElement("article");
      var kind = document.createElement("span"); kind.className = "note-kind"; kind.textContent = note.kind || "note";
      var title = document.createElement("h3"); title.textContent = note.title || note.id;
      var text = document.createElement("p"); text.textContent = note.text;
      article.appendChild(kind); article.appendChild(title); article.appendChild(text); root.appendChild(article);
    });
    inspector.classList.add("open");
  }

  qs("#action-inspector-close").onclick = function () { qs("#action-inspector").classList.remove("open"); };

  function highlightAction(action) {
    activeActionId = action.id;
    qsa(".action-active, .action-destination", world).forEach(function (element) { element.classList.remove("action-active", "action-destination"); });
    var anchor = qs('[data-action="' + action.id + '"]', world);
    if (anchor) anchor.classList.add("action-active");
    if (action.connectionId) {
      var line = qs('[data-line-id="' + action.connectionId + '"]', world);
      var hit = qs('[data-connection-id="' + action.connectionId + '"]', world);
      if (line) line.classList.add("action-active");
      if (hit) hit.classList.add("action-active");
    }
    if (action.outcome && action.outcome.type === "frame") {
      var destination = stepFor(action.outcome.frameId);
      if (destination) destination.classList.add("action-destination");
    }
  }

  function performAction(action) {
    if (!action) return;
    highlightAction(action);
    showActionInspector(action);
    if (action.outcome && action.outcome.type === "frame") {
      var fromTitle = frameById[action.from.frameId]?.title || action.from.frameId;
      var toTitle = frameById[action.outcome.frameId]?.title || action.outcome.frameId;
      var status = qs("#transition-status");
      status.textContent = fromTitle + " → " + (action.label || action.id) + " → " + toTitle;
      status.classList.add("show");
      clearTimeout(transitionTimer);
      transitionTimer = setTimeout(function () { status.classList.remove("show"); }, 5000);
      setMode("board");
      activate(action.outcome.frameId, true);
      stepFor(action.outcome.frameId).classList.add("action-destination");
      toast("Outcome frame highlighted. Press Enter or switch to Run to keep exploring.");
    } else toast((action.label || action.id) + " triggered");
  }

  actions.forEach(function (action) {
    qsa('[data-action="' + action.id + '"]', world).forEach(function (anchor) {
      anchor.classList.add("canvas-action-anchor");
      if (notesFor("action", action.id).length) anchor.classList.add("has-action-note");
      if (action.trigger === "scroll") {
        anchor.addEventListener("scroll", function () {
          clearTimeout(scrollTimers[action.id]);
          scrollTimers[action.id] = setTimeout(function () { performAction(action); }, 120);
        }, { passive: true });
      }
      if (action.trigger === "hover") anchor.addEventListener("pointerenter", function () { if (document.body.dataset.mode === "interact") performAction(action); });
    });
  });

  document.addEventListener("click", function (event) {
    if (document.body.dataset.mode !== "interact" || document.body.classList.contains("comment-on")) return;
    var anchor = event.target.closest("[data-action]");
    if (anchor) {
      var action = actionById[anchor.dataset.action];
      if (action && action.trigger === "click") { event.preventDefault(); performAction(action); return; }
    }
    var target = event.target.closest("[data-goto]");
    if (target) { event.preventDefault(); activate(target.dataset.goto, true); return; }
    target = event.target.closest("[data-toast]");
    if (target) { event.preventDefault(); toast(target.dataset.toast); }
  });

  function emptyDraft() {
    return { reviewId: reviewCycle.id, baseRevision: revision.id, baseFeedbackRevision: feedbackRevision, comments: [], deletedIds: [], archivedIds: [] };
  }

  function draftEnvelope() {
    try {
      var stored = localStorage.getItem(storeKey);
      if (!stored) return emptyDraft();
      var parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return { reviewId: null, baseRevision: null, baseFeedbackRevision: 0, comments: parsed, deletedIds: [], archivedIds: [] };
      return {
        reviewId: parsed.reviewId || null,
        baseRevision: parsed.baseRevision || null,
        baseFeedbackRevision: Number(parsed.baseFeedbackRevision) || 0,
        submittedAt: parsed.submittedAt || null,
        comments: parsed.comments || [],
        deletedIds: parsed.deletedIds || [],
        archivedIds: parsed.archivedIds || []
      };
    } catch (error) { return emptyDraft(); }
  }

  // every comment the canonical file and the local draft agree on, without the review-completed
  // gate — the review list needs that gate, a status report must not hide comments behind it
  function reconciledComments() {
    return feedbackProtocol.reconcile(canonicalFeedback, draftEnvelope(), revision.targetHashes || {}, {
      review: reviewCycle,
      feedbackRevision: feedbackRevision,
      archivedIds: feedbackProtocol.archivedCommentIds(feedbackMeta.archive)
    });
  }

  function loadComments() {
    if (localStorage.getItem(completedKey) === "1" || reviewCycle.status === "completed") return [];
    return reconciledComments();
  }

  function persistDraft(state) {
    localStorage.setItem(storeKey, JSON.stringify({
      reviewId: reviewCycle.id,
      baseRevision: revision.id,
      baseFeedbackRevision: feedbackRevision,
      updatedAt: new Date().toISOString(),
      submittedAt: state.submittedAt || null,
      comments: (state.comments || []).map(feedbackProtocol.stripDerived),
      deletedIds: state.deletedIds || [],
      archivedIds: state.archivedIds || []
    }));
  }

  function saveComments(list, deletedId) {
    var previous = draftEnvelope();
    var deleted = new Set(previous.deletedIds || []);
    if (deletedId) deleted.add(deletedId);
    if (reviewCycle.status === "active" && localStorage.getItem(completedKey) === "1") {
      localStorage.removeItem(completedKey);
      toast("New comment reopened the current review.");
    }
    persistDraft({ comments: list, deletedIds: Array.from(deleted), archivedIds: previous.archivedIds });
    renderPins();
  }

  function markSubmitted(list, archivedIds) {
    var previous = draftEnvelope();
    var archived = new Set(previous.archivedIds || []);
    (archivedIds || []).forEach(function (id) { archived.add(id); });
    persistDraft({
      comments: list,
      deletedIds: previous.deletedIds,
      archivedIds: Array.from(archived),
      submittedAt: new Date().toISOString()
    });
  }

  function setCommentMarkerContent(element, label) {
    element.innerHTML = "";
    var glyph = document.createElement("span"); glyph.className = "comment-glyph"; glyph.setAttribute("aria-hidden", "true");
    var index = document.createElement("span"); index.className = "comment-index"; index.textContent = label;
    element.appendChild(glyph); element.appendChild(index);
  }

  function addPinToFrame(frameId, x, y, label, className, onClick) {
    var step = stepFor(frameId);
    if (!step) return;
    var pin = document.createElement("button");
    pin.type = "button";
    pin.className = className;
    pin.style.left = x + "%";
    pin.style.top = y + "%";
    setCommentMarkerContent(pin, label);
    pin.onclick = function (event) { event.stopPropagation(); onClick(pin); };
    qs(".device", step).appendChild(pin);
  }

  function addConnectionPin(connectionId, label, className, onClick) {
    var point = connectionPoints[connectionId];
    if (!point) return;
    var pin = document.createElement("button");
    pin.type = "button";
    pin.className = className + " world-pin";
    pin.style.left = point.x + "px";
    pin.style.top = point.y + "px";
    setCommentMarkerContent(pin, label);
    pin.onclick = function (event) { event.stopPropagation(); onClick(pin); };
    world.appendChild(pin);
  }

  function addGroupPin(groupId, label, className, onClick) {
    var group = qs('[data-group-id="' + groupId + '"]', world);
    if (!group) return;
    var pin = document.createElement("button");
    pin.type = "button";
    pin.className = className + " world-pin";
    pin.style.left = (group.offsetLeft + 14) + "px";
    pin.style.top = (group.offsetTop + 14) + "px";
    setCommentMarkerContent(pin, label);
    pin.onclick = function (event) { event.stopPropagation(); onClick(pin); };
    world.appendChild(pin);
  }

  function addCanvasPin(label, className, onClick) {
    var pin = document.createElement("button");
    pin.type = "button";
    pin.className = className + " world-pin";
    pin.style.left = "28px";
    pin.style.top = "28px";
    setCommentMarkerContent(pin, label);
    pin.onclick = function (event) { event.stopPropagation(); onClick(pin); };
    world.appendChild(pin);
  }

  function addActionPin(actionId, label, className, onClick) {
    var anchor = qs('[data-action="' + actionId + '"]', world);
    if (!anchor) return;
    var device = anchor.closest(".device");
    var anchorRect = anchor.getBoundingClientRect();
    var deviceRect = device.getBoundingClientRect();
    if (!deviceRect.width || !deviceRect.height) return;
    var x = (anchorRect.right - deviceRect.left) / deviceRect.width * 100;
    var y = (anchorRect.top - deviceRect.top) / deviceRect.height * 100;
    var frameId = device.closest(".flow-step").dataset.frameId;
    addPinToFrame(frameId, x, y, label, className, onClick);
  }

  function addRegionComment(comment, label, className, onClick) {
    var step = stepFor(comment.target.id);
    var anchor = comment.target.anchor;
    if (!step || !anchor) return;
    var region = document.createElement("button");
    region.type = "button";
    region.className = className;
    region.style.left = anchor.x + "%";
    region.style.top = anchor.y + "%";
    region.style.width = anchor.width + "%";
    region.style.height = anchor.height + "%";
    region.setAttribute("aria-label", "Region comment " + label + ": " + comment.text);
    setCommentMarkerContent(region, label);
    region.onclick = function (event) { event.stopPropagation(); onClick(region); };
    qs(".device", step).appendChild(region);
  }

  function addTargetPin(target, label, className, onClick) {
    if (!target) return;
    if (target.type === "frame") {
      var point = target.anchor?.kind === "point" ? target.anchor : target;
      addPinToFrame(target.id, point.x == null ? 50 : point.x, point.y == null ? 8 : point.y, label, className, onClick);
    }
    else if (target.type === "connection") addConnectionPin(target.id, label, className, onClick);
    else if (target.type === "action") addActionPin(target.id, label, className, onClick);
    else if (target.type === "group") addGroupPin(target.id, label, className, onClick);
    else if (target.type === "canvas") addCanvasPin(label, className, onClick);
    else if (target.type === "note") {
      var note = presetNotes.find(function (item) { return item.id === target.id; });
      if (note) addTargetPin(note.target, label, className, onClick);
    }
  }

  function renderPins() {
    qsa(".pin, .comment-region", world).forEach(function (pin) { pin.remove(); });
    var list = loadComments();
    /* A resolved comment keeps its pin, marked with a check, until the reviewer clears it: that
       pin is how they find the agent's change summary after a reload. */
    function isReviewTarget(comment) {
      return comment.target && comment.target.type !== "canvas";
    }
    var openCount = 0;
    list.forEach(function (comment, index) {
      if (!isReviewTarget(comment)) return;
      var resolved = comment.status === "resolved";
      var states = (resolved ? " resolved" : comment.status === "discussion" ? " discussion" : " open") + (comment.reviewState === "outdated" ? " outdated" : "") + (comment.reviewState === "unbound" ? " unbound" : "");
      var label = resolved ? "✓" : String(++openCount);
      if (comment.target.type === "frame" && comment.target.anchor?.kind === "region") {
        addRegionComment(comment, label, "comment-region" + states, function (region) { openEditPopover(region, comment, index); });
      } else {
        addTargetPin(comment.target, label, "pin" + states, function (pin) { openEditPopover(pin, comment, index); });
      }
    });
    var count = qs("#cmt-count");
    count.textContent = openCount ? String(openCount) : "";
    var resolvedCount = list.filter(function (comment) { return comment.status === "resolved"; }).length;
    var unanchoredCount = list.filter(function (comment) { return comment.status !== "resolved" && comment.target?.type === "canvas"; }).length;
    count.title = openCount + " comment(s) to review · " + resolvedCount + " resolved, waiting to be cleared" + (unanchoredCount ? " · " + unanchoredCount + " unanchored hidden" : "");
  }

  qs("#notes-btn").onclick = function () {
    var on = document.body.classList.toggle("notes-on");
    if (on) {
      document.body.classList.remove("comment-on");
      qs("#comment-btn").classList.remove("on");
      qs("#comment-btn").setAttribute("aria-pressed", "false");
      closePopover();
    }
    this.classList.toggle("on", on);
    this.setAttribute("aria-pressed", String(on));
    setMode("board");
    renderPlanningNotes();
    renderPins();
  };

  qs("#comment-btn").onclick = function () {
    var on = document.body.classList.toggle("comment-on");
    if (on && document.body.dataset.mode !== "board") setMode("board", { preserveViewport: true });
    if (on && document.body.classList.contains("notes-on")) {
      document.body.classList.remove("notes-on");
      qs("#notes-btn").classList.remove("on");
      qs("#notes-btn").setAttribute("aria-pressed", "false");
      renderPlanningNotes();
    }
    this.classList.toggle("on", on);
    this.setAttribute("aria-pressed", String(on));
    closePopover();
    renderPins();
    if (on) toast("Click for a point comment · drag inside a frame for a region comment");
  };

  var popover = qs("#popover");

  function placePopover(clientX, clientY) {
    popover.style.display = "block";
    popover.style.left = Math.max(8, Math.min(clientX + 10, window.innerWidth - Math.min(382, window.innerWidth - 8))) + "px";
    popover.style.top = Math.max(8, Math.min(clientY + 12, window.innerHeight - Math.min(560, window.innerHeight - 8))) + "px";
  }

  function closePopover() { popover.style.display = "none"; popover.innerHTML = ""; }
  function newCommentId() { return "comment-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7); }
  function newMessageId() { return "message-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7); }

  function openNewPopover(target, clientX, clientY) {
    popover.innerHTML = '<textarea aria-label="Feedback" placeholder="Write your feedback"></textarea><label class="rule-proposal-toggle"><input class="rule-proposal-input" type="checkbox"> Common rule candidate for multiple frames/canvases</label><div class="pop-row"><button class="primary" type="button">Add comment</button><button class="pop-cancel" type="button">Cancel</button></div>';
    placePopover(clientX, clientY);
    var textarea = qs("textarea", popover);
    textarea.focus();
    qs(".primary", popover).onclick = function () {
      if (!textarea.value.trim()) return;
      var list = loadComments();
      var now = new Date().toISOString();
      var comment = { id: newCommentId(), target: target, targetRevision: revision.targetHashes[target.id] || null, text: textarea.value.trim(), status: "open", author: { id: null, label: "Local reviewer" }, createdAt: now, updatedAt: now, thread: [] };
      if (qs(".rule-proposal-input", popover).checked) {
        comment.ruleProposal = {
          status: "proposed",
          title: "Common rule found in a comment",
          priority: "should",
          category: "general",
          statement: comment.text,
          rationale: "The user marked this feedback as a candidate to apply across multiple frames or canvases.",
          appliesTo: [target.type],
          verification: { type: "agent-checklist", checks: [comment.text] }
        };
      }
      list.push(comment);
      saveComments(list);
      closePopover();
    };
    qs(".pop-cancel", popover).onclick = closePopover;
  }

  function openEditPopover(pin, comment, index) {
    popover.innerHTML = '<div class="comment-state-row"><strong class="comment-state-label"></strong><span class="comment-revision"></span></div><textarea aria-label="Feedback"></textarea><label class="rule-proposal-toggle"><input class="rule-proposal-input" type="checkbox"> Common rule candidate for multiple frames/canvases</label><div class="rule-proposal-state" hidden></div><div class="comment-thread"></div><div class="comment-resolution" hidden></div><div class="comment-reply"><textarea aria-label="Thread reply" placeholder="Answer the agent or add another note"></textarea><button class="pop-reply" type="button">Add reply</button></div><div class="pop-row"><button class="primary" type="button">Save</button><button class="pop-resolve" type="button">' + (comment.status === "resolved" ? "Reopen" : "Mark resolved") + '</button><button class="danger" type="button">Delete</button></div>';
    var rect = pin.getBoundingClientRect();
    placePopover(rect.right, rect.bottom);
    var textarea = qs("textarea", popover);
    textarea.value = comment.text;
    var proposalInput = qs(".rule-proposal-input", popover);
    proposalInput.checked = !!comment.ruleProposal && comment.ruleProposal.status !== "rejected";
    if (comment.ruleProposal) {
      var proposalState = qs(".rule-proposal-state", popover);
      proposalState.hidden = false;
      proposalState.textContent = comment.ruleProposal.status === "approved"
        ? "Common rule approved · waiting for the agent after you save feedback"
        : comment.ruleProposal.status === "rejected" ? "Dropped as a common rule candidate" : "Common rule pending approval";
    }
    var labels = { open: "Open", discussion: "Needs discussion", resolved: "Resolved" };
    qs(".comment-state-label", popover).textContent = labels[comment.status] || comment.status;
    qs(".comment-state-label", popover).dataset.status = comment.status;
    qs(".comment-revision", popover).textContent = comment.reviewState === "outdated" ? "Target changed" : comment.reviewState === "unbound" ? "Not bound to a revision" : "Current revision";
    var thread = qs(".comment-thread", popover);
    (comment.thread || []).forEach(function (message) {
      var item = document.createElement("article");
      item.className = "comment-message " + message.author.type;
      var head = document.createElement("strong"); head.textContent = message.author.label;
      var body = document.createElement("p"); body.textContent = message.text;
      item.appendChild(head); item.appendChild(body); thread.appendChild(item);
    });
    if (!(comment.thread || []).length) thread.hidden = true;
    if (comment.resolution) {
      var resolutionBox = qs(".comment-resolution", popover);
      resolutionBox.hidden = false;
      var title = document.createElement("strong"); title.textContent = "Change summary";
      var summary = document.createElement("p"); summary.textContent = comment.resolution.summary;
      resolutionBox.appendChild(title); resolutionBox.appendChild(summary);
      (comment.resolution.changes || []).forEach(function (change) {
        var row = document.createElement("p"); row.textContent = "#" + change.targetId + " · " + change.summary; resolutionBox.appendChild(row);
      });
    }
    qs(".primary", popover).onclick = function () {
      if (!textarea.value.trim()) return;
      var list = loadComments();
      var item = list[index];
      var previousStatement = item.ruleProposal?.statement;
      item.text = textarea.value.trim();
      if (proposalInput.checked) {
        var keepApproval = item.ruleProposal?.status === "approved" && previousStatement === item.text;
        item.ruleProposal = {
          ...(item.ruleProposal || {}),
          status: keepApproval ? "approved" : "proposed",
          title: item.ruleProposal?.title || "Common rule found in a comment",
          priority: item.ruleProposal?.priority || "should",
          category: item.ruleProposal?.category || "general",
          statement: item.text,
          rationale: item.ruleProposal?.rationale || "This feedback may apply repeatedly across multiple frames or canvases.",
          appliesTo: item.ruleProposal?.appliesTo || [item.target.type],
          verification: item.ruleProposal?.verification || { type: "agent-checklist", checks: [item.text] }
        };
      } else delete item.ruleProposal;
      item.updatedAt = new Date().toISOString();
      saveComments(list); closePopover();
    };
    qs(".pop-reply", popover).onclick = function () {
      var reply = qs(".comment-reply textarea", popover);
      if (!reply.value.trim()) return;
      var list = loadComments();
      list[index].thread = list[index].thread || [];
      list[index].thread.push({ id: newMessageId(), author: { type: "user", label: "Local reviewer" }, text: reply.value.trim(), createdAt: new Date().toISOString() });
      if (list[index].status === "resolved") { list[index].status = "open"; delete list[index].resolution; }
      list[index].updatedAt = new Date().toISOString();
      saveComments(list); closePopover();
    };
    qs(".pop-resolve", popover).onclick = function () {
      var list = loadComments(); var item = list[index]; var now = new Date().toISOString();
      if (item.status === "resolved") { item.status = "open"; delete item.resolution; }
      else {
        item.status = "resolved";
        item.targetRevision = revision.targetHashes[item.target.id] || item.targetRevision;
        item.resolution = { summary: "Resolved directly by the user on the canvas.", changes: [], resolvedAt: now, resolvedBy: { type: "user", label: "Local reviewer" } };
      }
      item.updatedAt = now; saveComments(list); closePopover();
    };
    qs(".danger", popover).onclick = function () { var list = loadComments(); var removed = list[index].id; list.splice(index, 1); saveComments(list, removed); closePopover(); };
  }

  function openNotePopover(pin, note) {
    popover.innerHTML = '<span class="note-kind"></span><h3 class="pop-note-title"></h3><div class="pop-note-body"></div><div class="pop-row"><button class="pop-cancel" type="button">Close</button></div>';
    qs(".note-kind", popover).textContent = note.kind || "note";
    qs(".pop-note-title", popover).textContent = note.title || note.id;
    qs(".pop-note-body", popover).textContent = note.text;
    var rect = pin.getBoundingClientRect(); placePopover(rect.right, rect.bottom);
    qs(".pop-cancel", popover).onclick = closePopover;
  }

  document.addEventListener("click", function (event) {
    if (!document.body.classList.contains("comment-on")) return;
    if (suppressRegionClick) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (event.target.closest("#popover, #deck, #modal, #zoom-hud, #action-inspector, .pin, .comment-region")) return;
    var actionAnchor = event.target.closest("[data-action]");
    if (actionAnchor && actionById[actionAnchor.dataset.action]) {
      event.preventDefault(); event.stopImmediatePropagation();
      openNewPopover({ type: "action", id: actionAnchor.dataset.action }, event.clientX, event.clientY); return;
    }
    var connectionHit = event.target.closest(".cn-hit");
    if (connectionHit) {
      event.preventDefault(); event.stopImmediatePropagation();
      openNewPopover({ type: "connection", id: connectionHit.dataset.connectionId }, event.clientX, event.clientY); return;
    }
    var device = event.target.closest(".device");
    if (!device) {
      closePopover();
      return;
    }
    event.preventDefault(); event.stopImmediatePropagation();
    var step = device.closest(".flow-step");
    var rect = device.getBoundingClientRect();
    var x = Math.round((event.clientX - rect.left) / rect.width * 1000) / 10;
    var y = Math.round((event.clientY - rect.top) / rect.height * 1000) / 10;
    openNewPopover({ type: "frame", id: step.dataset.frameId, x: x, y: y, anchor: { kind: "point", x: x, y: y } }, event.clientX, event.clientY);
  }, true);

  function openModal(title, build) {
    modalReturnFocus = document.activeElement;
    qs("#modal-title").textContent = title;
    var body = qs("#modal-body"); body.innerHTML = ""; build(body);
    qs("#modal").classList.add("open");
    requestAnimationFrame(function () { qs(".modal-close").focus(); });
  }
  function closeModal() {
    qs("#modal").classList.remove("open");
    if (modalReturnFocus && modalReturnFocus.focus) modalReturnFocus.focus();
    modalReturnFocus = null;
  }
  qs(".modal-close").onclick = closeModal;
  qs("#modal").addEventListener("click", function (event) { if (event.target === this) closeModal(); });

  function downloadJson(payload, filename) {
    var blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" });
    var link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); setTimeout(function () { URL.revokeObjectURL(link.href); }, 0);
  }

  var feedbackFileHandle = null;
  var handleDbKey = "feedback-file:" + canvasMeta.id;

  function openHandleDb() {
    return new Promise(function (resolve) {
      try {
        var request = indexedDB.open("supercanvas-canvas", 1);
        request.onupgradeneeded = function () { request.result.createObjectStore("handles"); };
        request.onerror = function () { resolve(null); };
        request.onsuccess = function () { resolve(request.result); };
      } catch (error) { resolve(null); }
    });
  }

  function loadStoredFileHandle() {
    return openHandleDb().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        var request = db.transaction("handles").objectStore("handles").get(handleDbKey);
        request.onerror = function () { db.close(); resolve(null); };
        request.onsuccess = function () { db.close(); resolve(request.result || null); };
      });
    });
  }

  function storeFileHandle(handle) {
    return openHandleDb().then(function (db) {
      if (!db) return;
      var store = db.transaction("handles", "readwrite").objectStore("handles");
      if (handle) store.put(handle, handleDbKey);
      else store.delete(handleDbKey);
      db.close();
    }).catch(function () { /* the handle is not persistable on this platform */ });
  }

  async function saveFeedbackToFile(portable) {
    var handle = feedbackFileHandle || await loadStoredFileHandle();
    if (handle) {
      try {
        var permission = await handle.queryPermission({ mode: "readwrite" });
        if (permission !== "granted") permission = await handle.requestPermission({ mode: "readwrite" });
        if (permission !== "granted") handle = null;
      } catch (error) { handle = null; }
    }
    if (!handle) {
      try {
        handle = await window.showSaveFilePicker({
          suggestedName: "feedback.json",
          types: [{ description: "Canvas feedback", accept: { "application/json": [".json"] } }]
        });
      } catch (error) {
        if (error && error.name === "AbortError") return false;
        throw error;
      }
      storeFileHandle(handle);
    }
    try {
      var writable = await handle.createWritable();
      await writable.write(JSON.stringify(portable, null, 2) + "\n");
      await writable.close();
    } catch (error) {
      feedbackFileHandle = null;
      storeFileHandle(null);
      throw error;
    }
    feedbackFileHandle = handle;
    return true;
  }

  function commentLines(comment, label) {
    var target = comment.target;
    var title = target.type === "frame" && frameById[target.id] ? frameById[target.id].title : target.type + " #" + target.id;
    var anchor = target.anchor?.kind === "region"
      ? " @ region " + target.anchor.x + "%," + target.anchor.y + "% " + target.anchor.width + "%×" + target.anchor.height + "%"
      : target.type === "frame" && (target.anchor?.kind === "point" || target.x != null)
        ? " @ point " + (target.anchor?.x ?? target.x) + "%," + (target.anchor?.y ?? target.y) + "%"
        : "";
    var statusLabel = comment.status === "resolved" ? "resolved" : comment.status === "discussion" ? "needs discussion" : "open";
    var lines = [label + ". [" + title + anchor + "] (" + statusLabel + ")" + (comment.reviewState === "outdated" ? " (target changed)" : "") + " " + comment.text];
    (comment.thread || []).forEach(function (message) { lines.push("   - " + message.author.label + ": " + message.text); });
    if (comment.resolution) lines.push("   - change summary: " + comment.resolution.summary);
    if (comment.ruleProposal) lines.push("   - common rule candidate (" + comment.ruleProposal.status + "): " + comment.ruleProposal.statement);
    return lines;
  }

  /* Comments archived by an earlier save in this page session are still in the rendered canonical
     snapshot. Carry them back into the rotation so a second save before the next render cannot
     write a file that has dropped them from both comments and archive. */
  function carriedArchive(draft) {
    var archivedHere = new Set(draft.archivedIds || []);
    var inFile = new Set(feedbackProtocol.archivedCommentIds(feedbackMeta.archive));
    return canonicalFeedback.filter(function (comment) { return archivedHere.has(comment.id) && !inFile.has(comment.id); });
  }

  function feedbackPayload(comments, archive, archivedIds) {
    return {
      comments: comments,
      archivedIds: archivedIds || [],
      portable: feedbackProtocol.portable({
        canvasId: canvasMeta.id,
        canvasVersion: canvasMeta.version,
        baseRevision: revision.id,
        feedbackRevision: feedbackRevision,
        review: reviewCycle,
        archive: archive || []
      }, comments)
    };
  }

  /* Saving writes the review as it stands, resolved comments included. Closed comments only leave
     the file through Clear resolved, so a save never hides an agent's answer before the reviewer
     has reloaded and looked at it. */
  function savePayload() {
    return feedbackPayload(loadComments(), feedbackMeta.archive, []);
  }

  function clearResolvedPayload() {
    var rotation = feedbackProtocol.rotate(feedbackMeta.archive, reviewCycle, loadComments().concat(carriedArchive(draftEnvelope())));
    return feedbackPayload(rotation.active, rotation.archive, rotation.archivedIds);
  }

  function feedbackMarkdown(comments) {
    var lines = ["## Canvas feedback — " + canvasMeta.title + " (" + canvasMeta.version + ")", "Review: " + reviewCycle.id + " · feedback revision " + feedbackRevision];
    if (!comments.length) lines.push("(no comments)");
    comments.forEach(function (comment, index) { lines.push.apply(lines, commentLines(comment, String(index + 1))); });
    return lines.join("\n");
  }

  function markSaved(payload) {
    markSubmitted(payload.comments, payload.archivedIds);
    renderPins();
  }

  function postFeedback(portable) {
    return fetch(reviewServer.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-supercanvas-token": reviewServer.token },
      body: JSON.stringify(portable)
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (result) {
        if (!response.ok) throw new Error(result.error || "The review server refused the save.");
        return result;
      });
    });
  }

  function saveFeedback(payload, message) {
    if (!reviewServer) return openSaveFallback(payload);
    postFeedback(payload.portable).then(function (result) {
      markSaved(payload);
      toast(result.rendered ? message : message + " · re-render failed, run supercanvas update");
    }).catch(function (error) {
      toast("Server save failed: " + error.message);
      openSaveFallback(payload);
    });
  }

  /* Fallback for a canvas opened straight from disk, where nothing may write to the package. */
  function openSaveFallback(payload) {
    var markdown = feedbackMarkdown(payload.comments);
    openModal("Save feedback", function (body) {
      var canPickFile = typeof window.showSaveFilePicker === "function" && location.protocol !== "file:";
      body.innerHTML = '<textarea readonly aria-label="Markdown feedback"></textarea><div class="pop-row">'
        + (canPickFile ? '<button id="save-feedback-file" class="primary" type="button">Save to feedback.json</button>' : "")
        + '<button id="download-feedback" type="button">Download feedback.json</button><button id="copy-feedback-json" type="button">Copy JSON</button></div>'
        + '<div class="modal-hint">Run supercanvas view for one-click saving — it serves this canvas and writes the package\'s feedback.json for you. Until then, put this file in the canvas package so the agent can read it.</div>';
      qs("textarea", body).value = markdown;
      if (canPickFile) {
        qs("#save-feedback-file").onclick = function () {
          saveFeedbackToFile(payload.portable).then(function (saved) {
            if (!saved) { toast("Save cancelled · nothing was written."); return; }
            markSaved(payload); closeModal();
            toast("feedback.json saved · the agent can read it now.");
          }).catch(function () { toast("Direct save failed · use Download feedback.json instead."); });
        };
      }
      qs("#download-feedback").onclick = function () {
        downloadJson(payload.portable, "feedback.json"); markSaved(payload); toast("Feedback saved · waiting for the agent.");
      };
      qs("#copy-feedback-json").onclick = function () { copyText(JSON.stringify(payload.portable, null, 2), "Feedback JSON copied"); markSaved(payload); };
      copyText(markdown, "Markdown feedback copied");
    });
  }

  qs("#export-btn").onclick = function () {
    closeFileMenu();
    var payload = savePayload();
    saveFeedback(payload, "Saved to feedback.json · " + payload.comments.length + " comment(s) for the agent");
  };

  qs("#clear-resolved-comments").onclick = function () {
    closeFileMenu();
    var resolved = loadComments().filter(function (comment) { return comment.status === "resolved"; });
    if (!resolved.length) { toast("No resolved comments to clear."); return; }
    openModal("Clear resolved comments", function (body) {
      body.innerHTML = '<p class="modal-copy">Archives ' + resolved.length + ' resolved comment(s) into this review cycle. They leave the canvas but stay in the file\'s history, so reload first if you still want to check what changed.</p>'
        + '<div class="pop-row"><button id="confirm-clear-resolved" class="primary" type="button">Clear ' + resolved.length + ' resolved</button></div>';
      qs("#confirm-clear-resolved").onclick = function () {
        closeModal();
        saveFeedback(clearResolvedPayload(), resolved.length + " resolved comment(s) archived");
      };
    });
  };

  qs("#clear-all-comments").onclick = function () {
    closeFileMenu();
    if (reviewCycle.status === "active") localStorage.removeItem(completedKey);
    var list = loadComments();
    openModal("Clear all comments", function (body) {
      body.innerHTML = '<p class="modal-copy">Removes all ' + list.length + ' comment(s) on this canvas, resolved ones included, without archiving them.</p><div class="pop-row"><button id="confirm-clear-comments" type="button">Clear all comments</button></div>';
      qs("#confirm-clear-comments").onclick = function () {
        var previous = draftEnvelope();
        var deleted = new Set(previous.deletedIds || []);
        list.forEach(function (comment) { deleted.add(comment.id); });
        localStorage.removeItem(completedKey);
        persistDraft({ comments: [], deletedIds: Array.from(deleted), archivedIds: previous.archivedIds });
        closeModal(); renderPins();
        saveFeedback(feedbackPayload([], feedbackMeta.archive, []), "All comments cleared");
      };
    });
  };

  qs("#canvas-info-btn").onclick = function () {
    closeFileMenu();
    var list = reconciledComments();
    var counts = { open: 0, discussion: 0, resolved: 0 };
    list.forEach(function (comment) {
      var bucket = comment.status === "resolved" ? "resolved" : comment.status === "discussion" ? "discussion" : "open";
      counts[bucket] += 1;
    });
    var archivedCount = feedbackProtocol.archivedCommentIds(feedbackMeta.archive).length;
    var rows = [
      ["Engine", data.engine ? data.engine.name + " " + data.engine.version : "unknown — rendered before engine metadata existed"],
      ["File modified", new Date(document.lastModified).toLocaleString()],
      ["Revision", revision.id],
      ["Schema version", String(data.schemaVersion)],
      ["Canvas", canvasMeta.id + " · " + canvasMeta.version],
      ["Review cycle", reviewCycle.id + " · " + reviewCycle.status],
      ["Feedback revision", String(feedbackRevision)],
      ["Frames", String(frames.length)],
      ["Comments", counts.open + " open · " + counts.discussion + " discussion · " + counts.resolved + " resolved · " + archivedCount + " archived"]
    ];
    openModal("Canvas info", function (body) {
      var info = document.createElement("dl");
      info.className = "info-list";
      rows.forEach(function (row) {
        var term = document.createElement("dt"); term.textContent = row[0];
        var value = document.createElement("dd"); value.textContent = row[1];
        info.appendChild(term); info.appendChild(value);
      });
      body.appendChild(info);
    });
  };

  document.addEventListener("keydown", function (event) {
    if (event.key === "Tab" && qs("#modal").classList.contains("open")) {
      var focusable = qsa('button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])', qs("#modal"));
      if (focusable.length) {
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
      return;
    }
    if (event.key === "Escape") {
      if (!framePickerPanel.hidden) { closeFramePicker(); framePickerTrigger.focus(); return; }
      if (!fileMenuPanel.hidden) { closeFileMenu(); fileMenuTrigger.focus(); return; }
      if (qs("#modal").classList.contains("open")) { closeModal(); return; }
      if (popover.style.display === "block") { closePopover(); return; }
      if (qs("#action-inspector").classList.contains("open")) { qs("#action-inspector").classList.remove("open"); return; }
      if (document.body.dataset.mode === "interact") {
        var active = qs(".flow-step.active", world);
        setMode("board");
        if (active) requestAnimationFrame(function () { active.focus({ preventScroll: true }); });
      }
      return;
    }
    if (document.body.dataset.mode !== "board" || !["ArrowLeft", "ArrowRight"].includes(event.key) || event.target.closest("input, textarea")) return;
    var active = qs(".flow-step.active", world) || steps[0];
    var index = steps.indexOf(active);
    var next = event.key === "ArrowRight" ? Math.min(steps.length - 1, index + 1) : Math.max(0, index - 1);
    if (steps[next]) { event.preventDefault(); activate(steps[next].dataset.frameId, true); steps[next].focus({ preventScroll: true }); }
  });

  drawConnectors();
  window.addEventListener("resize", function () {
    drawConnectors();
    if (activeActionId && actionById[activeActionId]) highlightAction(actionById[activeActionId]);
    renderPlanningNotes();
    renderPins();
    if (document.body.dataset.mode === "board") pz.fit();
  });
  if (steps[0]) activate(steps[0].dataset.frameId);
  renderPins();
  pz.fit();
  setTimeout(function () { toast("Board: pan/zoom · Run: scroll/hover/click inside a frame · Esc: back to board"); }, 400);

  /* The agent works on the package while this page stays open. Watching the canonical revision
     turns "reload to see what changed" into something the reviewer is told, not something they
     have to guess. Their own saves leave the revision alone, so this only fires for agent work. */
  function watchForAgentUpdates() {
    var announced = false;
    setInterval(function () {
      if (announced) return;
      fetch(reviewServer.endpoint, { cache: "no-store" })
        .then(function (response) { return response.ok ? response.json() : null; })
        .then(function (state) {
          if (!state || Number(state.feedbackRevision) <= feedbackRevision) return;
          announced = true;
          var badge = qs("#ver-badge");
          badge.textContent = canvasMeta.version + " · updated";
          badge.title = "The agent changed this canvas. Click to reload.";
          badge.style.cursor = "pointer";
          badge.onclick = function () { location.reload(); };
          toast("The agent updated this canvas · reload to see the changes");
        })
        .catch(function () { /* the server went away — the page still works read-only */ });
    }, 10000);
  }
  if (reviewServer) watchForAgentUpdates();

  window.__canvas = {
    data: data,
    revision: revision,
    loadComments: loadComments,
    saveComments: saveComments,
    activate: activate,
    setMode: setMode,
    performAction: performAction,
    fit: pz.fit,
    view: pz.view
  };
})();
