/**
 * vNetCard Studio - Application Router & State Manager
 *
 * Hash-based SPA router, global state, auto-save, keyboard shortcuts,
 * sidebar management, and app initialization for the vNetCard Studio PWA.
 * Exposes a global `window.App` object.
 *
 * (c) vNetCard - All rights reserved.
 */

(function () {
  "use strict";

  // ─── GLOBAL STATE ───────────────────────────────────────────────────────────

  var AppState = {
    currentCardId: null,
    currentStep: 1,
    cardData: {},
    isDirty: false,
  };

  window.AppState = AppState;

  // ─── CONSTANTS ──────────────────────────────────────────────────────────────

  var AUTO_SAVE_INTERVAL_MS = 30000;
  var _autoSaveTimer = null;

  var ROUTES = {
    dashboard: "dashboard",
    intake: "intake",
    preview: "preview",
    buildsheet: "buildsheet",
  };

  var SIDEBAR_ITEMS = [
    { label: "Dashboard", hash: "#dashboard", icon: "dashboard" },
    { label: "New Card", hash: "#intake", icon: "new-card" },
    { label: "Settings", hash: "#settings", icon: "settings" },
  ];

  // ─── ROUTE PARSING ──────────────────────────────────────────────────────────

  /**
   * Parse the current window.location.hash into a route name and parameters.
   * Supports formats: #dashboard, #intake?id=123, #preview?id=456
   * Returns { route: string, params: object }
   */
  function parseHash() {
    var hash = window.location.hash || "";
    if (hash.charAt(0) === "#") {
      hash = hash.substring(1);
    }

    var parts = hash.split("?");
    var route = parts[0] || "";
    var params = {};

    if (parts[1]) {
      var pairs = parts[1].split("&");
      for (var i = 0; i < pairs.length; i++) {
        var kv = pairs[i].split("=");
        if (kv[0]) {
          params[decodeURIComponent(kv[0])] = kv[1]
            ? decodeURIComponent(kv[1])
            : "";
        }
      }
    }

    return { route: route, params: params };
  }

  /**
   * Get a query parameter from the current hash.
   */
  function getParam(name) {
    var parsed = parseHash();
    return parsed.params[name] || null;
  }

  // ─── VIEW MANAGEMENT ───────────────────────────────────────────────────────

  /**
   * Hide all view containers and show the one matching the given route.
   */
  function showView(route) {
    var views = document.querySelectorAll("[data-view]");
    for (var i = 0; i < views.length; i++) {
      views[i].style.display = "none";
    }

    var target = document.querySelector('[data-view="' + route + '"]');
    if (target) {
      target.style.display = "";
    }
  }

  /**
   * Call the init function for the given route's view module if available.
   */
  function initView(route, params) {
    switch (route) {
      case ROUTES.dashboard:
        if (typeof window.Dashboard !== "undefined" && window.Dashboard.init) {
          window.Dashboard.init();
        }
        break;
      case ROUTES.intake:
        if (params.id) {
          AppState.currentCardId = isNaN(Number(params.id))
            ? params.id
            : Number(params.id);
        } else {
          AppState.currentCardId = null;
          AppState.currentStep = 1;
          AppState.cardData = {};
          AppState.isDirty = false;
        }
        if (typeof window.Intake !== "undefined" && window.Intake.init) {
          window.Intake.init();
        }
        break;
      case ROUTES.preview:
        if (params.id) {
          AppState.currentCardId = isNaN(Number(params.id))
            ? params.id
            : Number(params.id);
        }
        if (typeof window.Preview !== "undefined" && window.Preview.init) {
          window.Preview.init();
        }
        break;
      case ROUTES.buildsheet:
        if (params.id) {
          AppState.currentCardId = isNaN(Number(params.id))
            ? params.id
            : Number(params.id);
        }
        if (typeof window.BuildSheet !== "undefined" && window.BuildSheet.init) {
          window.BuildSheet.init();
        }
        break;
      default:
        navigate("#dashboard");
        return;
    }
  }

  // ─── SIDEBAR MANAGEMENT ─────────────────────────────────────────────────────

  /**
   * Update the active class on sidebar navigation items based on the current route.
   */
  function updateSidebar(route) {
    var navItems = document.querySelectorAll("[data-nav]");
    for (var i = 0; i < navItems.length; i++) {
      var navRoute = navItems[i].getAttribute("data-nav");
      if (navRoute === route) {
        navItems[i].classList.add("active");
      } else {
        navItems[i].classList.remove("active");
      }
    }
  }

  /**
   * Initialize the mobile sidebar hamburger toggle.
   */
  function initSidebarToggle() {
    var toggle = document.getElementById("sidebar-toggle");
    var sidebar = document.getElementById("sidebar");

    if (!toggle || !sidebar) return;

    toggle.addEventListener("click", function () {
      sidebar.classList.toggle("open");
    });

    // Close sidebar when clicking a nav item on mobile
    var navItems = sidebar.querySelectorAll("[data-nav]");
    for (var i = 0; i < navItems.length; i++) {
      navItems[i].addEventListener("click", function () {
        sidebar.classList.remove("open");
      });
    }

    // Close sidebar on overlay click
    document.addEventListener("click", function (e) {
      if (
        sidebar.classList.contains("open") &&
        !sidebar.contains(e.target) &&
        e.target !== toggle &&
        !toggle.contains(e.target)
      ) {
        sidebar.classList.remove("open");
      }
    });
  }

  // ─── ROUTER ─────────────────────────────────────────────────────────────────

  /**
   * Main router handler. Parses the hash, shows the correct view,
   * updates the sidebar, and initializes the view module.
   */
  function handleRoute() {
    var parsed = parseHash();
    var route = parsed.route;
    var params = parsed.params;

    // Default to dashboard
    if (!route || !ROUTES[route]) {
      if (route !== "settings") {
        navigate("#dashboard");
        return;
      }
    }

    showView(route);
    updateSidebar(route);
    initView(route, params);

    console.log("[App] Route:", route, params);
  }

  /**
   * Programmatic navigation. Sets the hash which triggers the hashchange handler.
   */
  function navigate(hash) {
    if (hash.charAt(0) !== "#") {
      hash = "#" + hash;
    }
    window.location.hash = hash;
  }

  // ─── AUTO-SAVE ──────────────────────────────────────────────────────────────

  /**
   * Save the current card data to IndexedDB if dirty.
   */
  async function autoSave() {
    if (!AppState.isDirty) return;

    try {
      var dataToSave = Object.assign({}, AppState.cardData);
      if (AppState.currentCardId) {
        dataToSave.id = AppState.currentCardId;
      }

      var saved = await DB.saveCard(dataToSave);
      AppState.currentCardId = saved.id;
      AppState.isDirty = false;

      showToast("Auto-saved");
      console.log("[App] Auto-saved card:", saved.id);
    } catch (err) {
      console.error("[App] Auto-save failed:", err);
    }
  }

  /**
   * Immediately save the current card (for Cmd+S shortcut).
   */
  async function saveNow() {
    if (!AppState.isDirty && !AppState.currentCardId) return;

    try {
      var dataToSave = Object.assign({}, AppState.cardData);
      if (AppState.currentCardId) {
        dataToSave.id = AppState.currentCardId;
      }

      var saved = await DB.saveCard(dataToSave);
      AppState.currentCardId = saved.id;
      AppState.isDirty = false;

      showToast("Saved");
      console.log("[App] Card saved:", saved.id);
    } catch (err) {
      console.error("[App] Save failed:", err);
      showToast("Save failed");
    }
  }

  /**
   * Start the auto-save interval.
   */
  function startAutoSave() {
    if (_autoSaveTimer) {
      clearInterval(_autoSaveTimer);
    }
    _autoSaveTimer = setInterval(autoSave, AUTO_SAVE_INTERVAL_MS);
  }

  // ─── TOAST ──────────────────────────────────────────────────────────────────

  /**
   * Show a subtle toast notification.
   */
  function showToast(message) {
    var existing = document.getElementById("app-toast");
    if (existing) {
      existing.remove();
    }

    var toast = document.createElement("div");
    toast.id = "app-toast";
    toast.textContent = message;
    toast.style.cssText =
      "position:fixed;bottom:24px;right:24px;background:#1a1a2e;" +
      "color:#fff;padding:10px 20px;border-radius:8px;font-size:14px;" +
      "z-index:9999;opacity:0;transition:opacity 0.3s ease;" +
      "box-shadow:0 4px 12px rgba(0,0,0,0.3);pointer-events:none;";

    document.body.appendChild(toast);

    // Fade in
    requestAnimationFrame(function () {
      toast.style.opacity = "1";
    });

    // Fade out and remove
    setTimeout(function () {
      toast.style.opacity = "0";
      setTimeout(function () {
        if (toast.parentNode) {
          toast.remove();
        }
      }, 300);
    }, 2000);
  }

  // ─── KEYBOARD SHORTCUTS ─────────────────────────────────────────────────────

  /**
   * Set up global keyboard shortcuts.
   */
  function initKeyboardShortcuts() {
    document.addEventListener("keydown", function (e) {
      // Cmd/Ctrl+S: save immediately
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        saveNow();
      }
    });
  }

  // ─── UNSAVED CHANGES WARNING ────────────────────────────────────────────────

  /**
   * Warn the user before leaving if there are unsaved changes.
   */
  function initBeforeUnload() {
    window.addEventListener("beforeunload", function (e) {
      if (AppState.isDirty) {
        e.preventDefault();
        e.returnValue = "You have unsaved changes";
        return "You have unsaved changes";
      }
    });
  }

  // ─── SERVICE WORKER ─────────────────────────────────────────────────────────

  /**
   * Register the service worker for offline PWA support.
   */
  function registerServiceWorker() {
    // Skip SW in local development to avoid caching issues
    if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') {
      console.log('[App] Skipping SW registration in development');
      return;
    }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("sw.js")
        .then(function (registration) {
          console.log(
            "[App] Service worker registered, scope:",
            registration.scope
          );
        })
        .catch(function (err) {
          console.error("[App] Service worker registration failed:", err);
        });
    }
  }

  // ─── SEED DATA ──────────────────────────────────────────────────────────────

  /**
   * Create the demo Pro-Tech card with all specified data.
   * Only called on first launch when no cards exist in the database.
   */
  async function seedDemoData() {
    var demoCard = {
      businessName: "Pro-Tech",
      contactName: "Jeff Miller",
      phone: "(407) 753-7983",
      email: "jeff@protechac.com",
      website: "https://protechac.com",
      industry: "HVAC + Plumbing + Electrical",
      primaryColor: "#1A2C5B",
      accentColor: "#F47C20",
      cardStyle: "Professional/Corporate",
      ctaGoal: "Book Calls",
      features: ["gallery", "reviews", "booking", "team", "faqs"],
      tabMode: "auto",
      mediaType: "video",
      welcomeAudioEnabled: true,
      welcomeAudioScript:
        "Hey, thanks for connecting with Pro-Tech! I'm Jeff Miller, and my team " +
        "specializes in HVAC, plumbing, and electrical services right here in " +
        "Central Florida. Tap Book Now to schedule your service call today!",
      footerTagline: "Licensed & Insured | Serving Central Florida",
      status: "draft",
      callLabel: "Call",
      textLabel: "Text",
      emailLabel: "Email",
      quickActionEnabled: false,
      title: "Owner, CEO",
      specialty: "HVAC · Plumbing · Electrical Specialist",
      serviceArea: "Central Florida",
      socialLinks: {
        facebook: "https://facebook.com/protechac",
        instagram: "https://instagram.com/protechac",
        linkedin: "https://linkedin.com/company/protechac",
        youtube: "https://youtube.com/@protechac",
        twitter: "https://x.com/protechac",
      },
    };

    try {
      var saved = await DB.saveCard(demoCard);
      console.log("[App] Demo card seeded:", saved.id);
      return saved;
    } catch (err) {
      console.error("[App] Failed to seed demo data:", err);
      return null;
    }
  }

  // ─── APP INITIALIZATION ─────────────────────────────────────────────────────

  /**
   * Main initialization entry point.
   * Called on DOMContentLoaded.
   */
  async function init() {
    console.log("[App] Initializing vNetCard Studio...");

    // Initialize IndexedDB
    try {
      await DB.init();
      console.log("[App] Database ready.");
    } catch (err) {
      console.error("[App] Database initialization failed:", err);
    }

    // Check for first launch and seed demo data if needed
    try {
      var cards = await DB.getAllCards();
      if (cards.length === 0) {
        console.log("[App] First launch detected. Seeding demo data...");
        await seedDemoData();
      }
    } catch (err) {
      console.error("[App] Failed to check cards:", err);
    }

    // Register service worker
    registerServiceWorker();

    // Set up keyboard shortcuts
    initKeyboardShortcuts();

    // Set up unsaved changes warning
    initBeforeUnload();

    // Set up sidebar toggle
    initSidebarToggle();

    // Start auto-save interval
    startAutoSave();

    // Set up hash-based routing
    window.addEventListener("hashchange", handleRoute);

    // Route to current hash or default to #dashboard
    handleRoute();

    console.log("[App] Initialization complete.");
  }

  // ─── DOM READY ──────────────────────────────────────────────────────────────

  document.addEventListener("DOMContentLoaded", function () {
    init();
  });

  // ─── EXPOSE PUBLIC API ──────────────────────────────────────────────────────

  window.App = {
    init: init,
    navigate: navigate,
    getParam: getParam,
    saveNow: saveNow,
    autoSave: autoSave,
    showToast: showToast,
    seedDemoData: seedDemoData,
    handleRoute: handleRoute,
  };
})();
