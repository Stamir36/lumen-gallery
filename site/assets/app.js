/* LUMEN site — three small behaviours and nothing else: sections fade in as
   they scroll into view, the small-screen navigation opens and closes, and a
   screenshot opens in a lightbox. No dependencies, no tracking, no network
   calls.

   The `js` class that gates the reveal animation is added by an inline script
   in <head> of every page, so a visitor without JavaScript still sees the
   whole page. Everything below degrades the same way: <details> opens the
   menu on its own, and the screenshots stay plain images. */
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* -------------------------------------------------------- reveal on scroll */
  var revealables = Array.prototype.slice.call(document.querySelectorAll(".reveal"));

  if (!("IntersectionObserver" in window) || reduced) {
    revealables.forEach(function (el) {
      el.classList.add("in");
    });
  } else {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.06 }
    );
    revealables.forEach(function (el) {
      io.observe(el);
    });
  }

  /* ------------------------------------------------------------ mobile menu */
  /* Styles decide whether the trigger is on screen (≤ 860 px); this only adds
     the conveniences a native <details> does not have: close on Escape, on an
     outside click, after following a link, and when the window grows. */
  var menu = document.querySelector("details.menu");

  if (menu) {
    var summary = menu.querySelector("summary");
    var wide = window.matchMedia("(min-width: 861px)");

    var closeMenu = function () {
      menu.open = false;
    };

    document.addEventListener("click", function (event) {
      if (menu.open && !menu.contains(event.target)) closeMenu();
    });

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || !menu.open) return;
      closeMenu();
      if (summary) summary.focus();
    });

    Array.prototype.forEach.call(menu.querySelectorAll("a"), function (link) {
      link.addEventListener("click", closeMenu);
    });

    var onBreakpoint = function (event) {
      if (event.matches) closeMenu();
    };
    if (wide.addEventListener) wide.addEventListener("change", onBreakpoint);
    else if (wide.addListener) wide.addListener(onBreakpoint);
  }

  /* --------------------------------------------------------------- lightbox */
  var shots = Array.prototype.slice.call(document.querySelectorAll(".shot[data-src]"));
  var box = document.getElementById("lightbox");

  if (!box || !shots.length) return;

  var img = box.querySelector("img");
  var count = box.querySelector(".lb-count");
  var index = 0;
  var lastFocus = null;
  var bodyOverflow = "";

  // Filled from the DOM: adding a screenshot can never leave a stale counter.
  if (count) count.textContent = "1 / " + shots.length;

  function render() {
    var shot = shots[index];
    img.src = shot.getAttribute("data-src");
    img.alt = shot.getAttribute("data-alt") || "";
    if (count) count.textContent = index + 1 + " / " + shots.length;
  }

  function controls() {
    return Array.prototype.slice.call(box.querySelectorAll("button:not([disabled])"));
  }

  function open(i) {
    index = i;
    lastFocus = document.activeElement;
    render();
    bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    box.setAttribute("data-open", "true");
    window.requestAnimationFrame(function () {
      box.setAttribute("data-shown", "true");
    });
    var closeBtn = box.querySelector("[data-close]");
    if (closeBtn) closeBtn.focus();
  }

  function close() {
    box.removeAttribute("data-shown");
    document.body.style.overflow = bodyOverflow;
    window.setTimeout(function () {
      box.removeAttribute("data-open");
    }, 180);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function step(delta) {
    index = (index + delta + shots.length) % shots.length;
    render();
  }

  shots.forEach(function (shot, i) {
    shot.addEventListener("click", function () {
      open(i);
    });
  });

  box.addEventListener("click", function (event) {
    var target = event.target;
    if (target === box || (target.hasAttribute && target.hasAttribute("data-close"))) {
      close();
    } else if (target.hasAttribute && target.hasAttribute("data-prev")) {
      step(-1);
    } else if (target.hasAttribute && target.hasAttribute("data-next")) {
      step(1);
    }
  });

  document.addEventListener("keydown", function (event) {
    if (box.getAttribute("data-open") !== "true") return;

    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowRight") {
      step(1);
      return;
    }
    if (event.key === "ArrowLeft") {
      step(-1);
      return;
    }
    // aria-modal: keyboard focus must stay inside the dialog while it is open.
    if (event.key !== "Tab") return;
    var items = controls();
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
})();
