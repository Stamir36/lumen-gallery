/* LUMEN site — two small behaviours and nothing else: sections fade in as they
   scroll into view, and a screenshot opens in a lightbox. No dependencies, no
   tracking, no network calls. */
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------------------------------------------------- reveal on scroll */
  var revealables = document.querySelectorAll(".reveal");

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

  /* --------------------------------------------------------------- lightbox */
  var shots = Array.prototype.slice.call(document.querySelectorAll(".shot[data-src]"));
  var box = document.getElementById("lightbox");

  if (box && shots.length) {
    var img = box.querySelector("img");
    var count = box.querySelector(".lb-count");
    var index = 0;
    var lastFocus = null;

    // Filled from the DOM: adding a screenshot can never leave a stale counter.
    if (count) count.textContent = "1 / " + shots.length;

    function render() {
      var shot = shots[index];
      img.src = shot.getAttribute("data-src");
      img.alt = shot.getAttribute("data-alt") || "";
      if (count) count.textContent = index + 1 + " / " + shots.length;
    }

    function close() {
      box.removeAttribute("data-shown");
      document.body.style.overflow = "";
      window.setTimeout(function () {
        box.removeAttribute("data-open");
      }, 180);
      if (lastFocus) lastFocus.focus();
    }

    function open(i) {
      index = i;
      lastFocus = document.activeElement;
      render();
      box.setAttribute("data-open", "true");
      document.body.style.overflow = "hidden";
      window.requestAnimationFrame(function () {
        box.setAttribute("data-shown", "true");
      });
      box.querySelector("[data-close]").focus();
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
      if (event.key === "Escape") close();
      else if (event.key === "ArrowRight") step(1);
      else if (event.key === "ArrowLeft") step(-1);
    });
  }
})();
