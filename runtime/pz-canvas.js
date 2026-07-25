/* PZCanvas extracted from the preserved reference. Dependency-free pan/zoom engine. */
(function (global) {
  "use strict";

  function PZCanvas(options) {
    var viewport = options.viewport;
    var world = options.world;
    var minScale = options.minScale || 0.1;
    var maxScale = options.maxScale || 4;
    var threshold = options.clickThreshold != null ? options.clickThreshold : 5;
    var view = { x: 0, y: 0, s: 1 };
    var drag = null;
    var suppressClick = false;

    viewport.classList.add("pz-viewport");
    world.classList.add("pz-world");

    function clamp(scale) {
      return Math.max(minScale, Math.min(maxScale, scale));
    }

    function apply() {
      world.style.transform = "translate(" + view.x + "px," + view.y + "px) scale(" + view.s + ")";
      if (options.onChange) options.onChange(view);
    }

    function animate() {
      world.classList.add("pz-anim");
      setTimeout(function () { world.classList.remove("pz-anim"); }, 320);
    }

    function fit() {
      var width = Math.max(1, world.offsetWidth);
      var height = Math.max(1, world.offsetHeight);
      var viewportWidth = viewport.clientWidth;
      var viewportHeight = viewport.clientHeight;
      view.s = clamp(Math.min(viewportWidth / width, viewportHeight / height, 1));
      view.x = (viewportWidth - width * view.s) / 2;
      view.y = (viewportHeight - height * view.s) / 2;
      apply();
    }

    function centerOn(element, scale) {
      var viewportWidth = viewport.clientWidth;
      var viewportHeight = viewport.clientHeight;
      if (scale) view.s = clamp(scale);
      view.x = viewportWidth / 2 - (element.offsetLeft + element.offsetWidth / 2) * view.s;
      view.y = viewportHeight / 2 - (element.offsetTop + element.offsetHeight / 2) * view.s;
      apply();
    }

    function zoomAt(clientX, clientY, factor) {
      var nextScale = clamp(view.s * factor);
      view.x = clientX - (clientX - view.x) * (nextScale / view.s);
      view.y = clientY - (clientY - view.y) * (nextScale / view.s);
      view.s = nextScale;
      apply();
    }

    function zoomBy(factor) {
      zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, factor);
    }

    function zoomTo(scale) {
      zoomBy(clamp(scale) / view.s);
    }

    function ignored(target) {
      return options.shouldIgnore ? !!options.shouldIgnore(target) : false;
    }

    viewport.addEventListener("wheel", function (event) {
      var ignoreWheel = options.shouldIgnoreWheel ? !!options.shouldIgnoreWheel(event.target) : ignored(event.target);
      if (ignoreWheel) return;
      event.preventDefault();
      world.classList.remove("pz-anim");
      var rect = viewport.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        zoomAt(event.clientX - rect.left, event.clientY - rect.top, Math.exp(-event.deltaY * 0.01));
      } else {
        view.x -= event.deltaX;
        view.y -= event.deltaY;
        apply();
      }
    }, { passive: false });

    viewport.addEventListener("pointerdown", function (event) {
      if (event.button !== 0 || ignored(event.target)) return;
      drag = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y, moved: false, id: event.pointerId, captured: false };
      if (options.captureOnPointerDown && options.captureOnPointerDown(event)) {
        try {
          viewport.setPointerCapture(event.pointerId);
          drag.captured = true;
        } catch (error) {
          drag.captured = false;
        }
      }
    });

    viewport.addEventListener("pointermove", function (event) {
      if (!drag) return;
      var dx = event.clientX - drag.x;
      var dy = event.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) > threshold) {
        drag.moved = true;
        viewport.classList.add("pz-panning");
        if (!drag.captured) {
          try {
            viewport.setPointerCapture(drag.id);
            drag.captured = true;
          } catch (error) {
            drag.captured = false;
          }
        }
        world.classList.remove("pz-anim");
      }
      if (drag.moved) {
        view.x = drag.vx + dx;
        view.y = drag.vy + dy;
        apply();
      }
    });

    function endDrag(event) {
      if (drag && drag.moved) {
        suppressClick = true;
        setTimeout(function () { suppressClick = false; }, 0);
      }
      if (drag && drag.captured && viewport.hasPointerCapture(drag.id)) viewport.releasePointerCapture(drag.id);
      drag = null;
      viewport.classList.remove("pz-panning");
    }

    viewport.addEventListener("pointerup", endDrag);
    viewport.addEventListener("pointercancel", endDrag);

    document.addEventListener("click", function (event) {
      if (!suppressClick) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      suppressClick = false;
    }, true);

    viewport.addEventListener("dragstart", function (event) { event.preventDefault(); });

    if (options.dblclickFit) {
      viewport.addEventListener("dblclick", function (event) {
        var allowed = typeof options.dblclickFit === "function" ? options.dblclickFit(event) : true;
        if (allowed && !ignored(event.target)) {
          animate();
          fit();
        }
      });
    }

    return {
      view: view,
      apply: apply,
      animate: animate,
      fit: fit,
      centerOn: centerOn,
      zoomAt: zoomAt,
      zoomBy: zoomBy,
      zoomTo: zoomTo
    };
  }

  global.PZCanvas = PZCanvas;
})(typeof window !== "undefined" ? window : this);
