/**
 * vNetCard Studio - Multi-Step Intake Form Wizard
 *
 * Seven-step intake wizard for creating and editing vNetCard business cards.
 * Handles validation, auto-save to IndexedDB via window.DB, live previews,
 * dynamic builders (tabs, FAQs, team members), and a review/generate step.
 *
 * Dependencies: window.DB, window.Utils
 * Exposes: window.Intake, window.AppState
 *
 * (c) vNetCard - All rights reserved.
 */

(function () {
  'use strict';

  var TOTAL_STEPS = 7;
  var MAX_CUSTOM_TABS = 8;
  var MAX_FAQS = 10;
  var MAX_TEAM_MEMBERS = 20;
  var MAX_SCRIPT_CHARS = 300;

  // ─── Global Application State ─────────────────────────────────────────────

  if (!window.AppState) {
    window.AppState = {};
  }

  var AppState = window.AppState;
  AppState.currentStep = 1;
  AppState.currentCardId = null;
  AppState.cardData = {};
  AppState.isDirty = false;

  // ─── Intake Module ────────────────────────────────────────────────────────

  var Intake = {};
  var _listeners = [];

  // ─── Helper: query within the intake form ─────────────────────────────────

  function $(selector) {
    var form = document.getElementById('intake-form');
    if (!form) return null;
    return form.querySelector(selector);
  }

  function $$(selector) {
    var form = document.getElementById('intake-form');
    if (!form) return [];
    return Array.prototype.slice.call(form.querySelectorAll(selector));
  }

  function getStepPanel(step) {
    return $('.step-panel[data-step="' + step + '"]');
  }

  // ─── Helper: bind event and track for cleanup ─────────────────────────────

  function listen(el, event, handler, opts) {
    if (!el) return;
    el.addEventListener(event, handler, opts || false);
    _listeners.push({ el: el, event: event, handler: handler, opts: opts || false });
  }

  function removeAllListeners() {
    _listeners.forEach(function (l) {
      l.el.removeEventListener(l.event, l.handler, l.opts);
    });
    _listeners = [];
  }

  // ─── Helper: set field value by name ──────────────────────────────────────

  function setFieldValue(name, value) {
    var field = $('[name="' + name + '"]');
    if (!field) return;

    if (field.type === 'checkbox') {
      field.checked = !!value;
    } else if (field.type === 'radio') {
      var radios = $$('[name="' + name + '"]');
      radios.forEach(function (r) {
        r.checked = r.value === String(value);
      });
    } else if (field.tagName === 'SELECT') {
      field.value = value || '';
    } else {
      field.value = value || '';
    }
  }

  function getFieldValue(name) {
    var field = $('[name="' + name + '"]');
    if (!field) return '';

    if (field.type === 'checkbox') {
      return field.checked;
    } else if (field.type === 'radio') {
      var radios = $$('[name="' + name + '"]');
      for (var i = 0; i < radios.length; i++) {
        if (radios[i].checked) return radios[i].value;
      }
      return '';
    } else {
      return field.value.trim();
    }
  }

  // ─── Helper: inline error display ─────────────────────────────────────────

  function showFieldError(name, message) {
    var field = $('[name="' + name + '"]');
    if (!field) return;

    field.classList.add('field-error');
    field.style.borderColor = '#ef4444';

    var existing = field.parentNode.querySelector('.inline-error');
    if (existing) existing.remove();

    var errEl = document.createElement('div');
    errEl.className = 'inline-error';
    errEl.style.cssText = 'color:#ef4444;font-size:12px;margin-top:4px;';
    errEl.textContent = message;
    field.parentNode.appendChild(errEl);
  }

  function clearFieldErrors(step) {
    var panel = getStepPanel(step);
    if (!panel) return;

    var errorFields = panel.querySelectorAll('.field-error');
    for (var i = 0; i < errorFields.length; i++) {
      errorFields[i].classList.remove('field-error');
      errorFields[i].style.borderColor = '';
    }

    var inlineErrors = panel.querySelectorAll('.inline-error');
    for (var j = 0; j < inlineErrors.length; j++) {
      inlineErrors[j].remove();
    }
  }

  // ─── Helper: update progress bar ──────────────────────────────────────────

  function updateProgressBar(step) {
    var bar = document.getElementById('intake-progress-bar');
    if (bar) {
      var pct = Math.round((step / TOTAL_STEPS) * 100);
      bar.style.width = pct + '%';
      bar.setAttribute('aria-valuenow', pct);
    }

    var label = document.getElementById('intake-progress-label');
    if (label) {
      label.textContent = 'Step ' + step + ' of ' + TOTAL_STEPS;
    }

    var indicators = $$('.step-indicator');
    indicators.forEach(function (ind, idx) {
      var s = idx + 1;
      ind.classList.remove('active', 'completed');
      if (s === step) {
        ind.classList.add('active');
      } else if (s < step) {
        ind.classList.add('completed');
      }
    });
  }

  // ─── Helper: thumbnail preview for URL fields ─────────────────────────────

  function showThumbnail(field) {
    var url = field.value.trim();
    var wrapper = field.parentNode;
    var existing = wrapper.querySelector('.url-thumbnail');
    if (existing) existing.remove();

    if (!url) return;

    var img = document.createElement('img');
    img.className = 'url-thumbnail';
    img.src = url;
    img.alt = 'Preview';
    img.style.cssText =
      'width:40px;height:40px;object-fit:cover;border-radius:4px;margin-top:4px;display:inline-block;border:1px solid #e5e7eb;';
    img.onerror = function () {
      img.style.display = 'none';
    };
    wrapper.appendChild(img);
  }

  // ─── Helper: sync color picker with hex text ──────────────────────────────

  function bindColorSync(colorInputName, textInputName) {
    var colorInput = $('[name="' + colorInputName + '"]');
    var textInput = $('[name="' + textInputName + '"]');
    if (!colorInput || !textInput) return;

    listen(colorInput, 'input', function () {
      textInput.value = colorInput.value;
      markDirty();
    });

    listen(textInput, 'input', function () {
      var val = textInput.value.trim();
      if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
        colorInput.value = val;
      }
      markDirty();
    });
  }

  // ─── Helper: mark form as dirty ───────────────────────────────────────────

  function markDirty() {
    AppState.isDirty = true;
    syncToAppState();
  }

  function syncToAppState() {
    AppState.cardData = Intake.collectFormData();
  }

  // ─── Helper: character counter for textareas ──────────────────────────────

  function bindCharCounter(textareaName, max) {
    var textarea = $('[name="' + textareaName + '"]');
    if (!textarea) return;

    var counter = textarea.parentNode.querySelector('.char-counter');
    if (!counter) {
      counter = document.createElement('div');
      counter.className = 'char-counter';
      counter.style.cssText = 'font-size:11px;color:#6b7280;text-align:right;margin-top:2px;';
      textarea.parentNode.appendChild(counter);
    }

    function update() {
      var len = textarea.value.length;
      counter.textContent = len + ' / ' + max;
      counter.style.color = len > max ? '#ef4444' : '#6b7280';
      if (len > max) {
        textarea.value = textarea.value.slice(0, max);
        counter.textContent = max + ' / ' + max;
      }
    }

    update();
    listen(textarea, 'input', function () {
      update();
      markDirty();
    });
  }

  // ─── Helper: toggle visibility based on control ───────────────────────────

  function bindToggle(controlName, targetSelector, showValue) {
    var controls = $$('[name="' + controlName + '"]');
    var target = $(targetSelector);
    if (!controls.length || !target) return;

    function update() {
      var val = getFieldValue(controlName);
      if (showValue === true) {
        target.style.display = val ? '' : 'none';
      } else {
        target.style.display = val === showValue ? '' : 'none';
      }
    }

    controls.forEach(function (ctrl) {
      listen(ctrl, 'change', function () {
        update();
        markDirty();
      });
    });

    update();
  }

  // ─── 1. Intake.init ───────────────────────────────────────────────────────

  Intake.init = async function (cardId) {
    removeAllListeners();

    AppState.currentStep = 1;
    AppState.isDirty = false;

    if (cardId) {
      AppState.currentCardId = cardId;
      var card = await DB.getCard(cardId);
      if (card) {
        AppState.cardData = card;
        Intake.populateForm(card);
      } else {
        console.warn('[Intake] Card not found:', cardId);
        resetForm();
      }
    } else {
      AppState.currentCardId = null;
      AppState.cardData = {};
      resetForm();
    }

    updateProgressBar(1);
    showStep(1);
    bindAllListeners();
  };

  // ─── 2. Intake.goToStep ───────────────────────────────────────────────────

  Intake.goToStep = function (stepNumber) {
    stepNumber = parseInt(stepNumber, 10);
    if (isNaN(stepNumber) || stepNumber < 1 || stepNumber > TOTAL_STEPS) return;

    var current = AppState.currentStep;

    // Validate current step when advancing forward
    if (stepNumber > current) {
      for (var s = current; s < stepNumber; s++) {
        clearFieldErrors(s);
        var result = Intake.validateStep(s);
        if (!result.valid) {
          result.errors.forEach(function (err) {
            showFieldError(err.field, err.message);
          });
          Utils.showToast('Please fix the errors before continuing.', 'error');
          return;
        }
      }
    }

    // Slide transition
    var currentPanel = getStepPanel(current);
    var nextPanel = getStepPanel(stepNumber);
    if (!nextPanel) return;

    var direction = stepNumber > current ? 1 : -1;

    if (currentPanel) {
      currentPanel.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
      currentPanel.style.transform = 'translateX(' + (-direction * 100) + '%)';
      currentPanel.style.opacity = '0';
      setTimeout(function () {
        currentPanel.style.display = 'none';
        currentPanel.style.transform = '';
        currentPanel.style.opacity = '';
        currentPanel.style.transition = '';
      }, 300);
    }

    nextPanel.style.display = 'block';
    nextPanel.style.transform = 'translateX(' + (direction * 100) + '%)';
    nextPanel.style.opacity = '0';

    // Force reflow
    void nextPanel.offsetWidth;

    nextPanel.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
    nextPanel.style.transform = 'translateX(0)';
    nextPanel.style.opacity = '1';

    setTimeout(function () {
      nextPanel.style.transition = '';
    }, 300);

    AppState.currentStep = stepNumber;
    updateProgressBar(stepNumber);

    // Scroll to top of form
    var form = document.getElementById('intake-form');
    if (form) {
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Build review if navigating to step 7
    if (stepNumber === TOTAL_STEPS) {
      buildReviewStep();
    }
  };

  // ─── 3. Intake.validateStep ───────────────────────────────────────────────

  Intake.validateStep = function (stepNumber) {
    var errors = [];

    if (stepNumber === 1) {
      var requiredFields = [
        { name: 'businessName', label: 'Business Name' },
        { name: 'contactName', label: 'Contact Name' },
        { name: 'phone', label: 'Phone' },
        { name: 'email', label: 'Email' },
        { name: 'industry', label: 'Industry' },
      ];

      requiredFields.forEach(function (f) {
        var val = getFieldValue(f.name);
        if (!val) {
          errors.push({ field: f.name, message: f.label + ' is required.' });
        }
      });

      // Validate email format
      var email = getFieldValue('email');
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push({ field: 'email', message: 'Please enter a valid email address.' });
      }

      // Validate phone has 10 digits
      var phone = getFieldValue('phone');
      if (phone) {
        var digits = phone.replace(/\D/g, '');
        if (digits.length < 10) {
          errors.push({ field: 'phone', message: 'Please enter a complete 10-digit phone number.' });
        }
      }
    }

    // Steps 2-6 have no required fields
    // Step 7 is the review step - no validation

    return {
      valid: errors.length === 0,
      errors: errors,
    };
  };

  // ─── 4. Intake.collectFormData ────────────────────────────────────────────

  Intake.collectFormData = function () {
    var data = {};

    // Preserve existing id and timestamps
    if (AppState.currentCardId) {
      data.id = AppState.currentCardId;
    }
    if (AppState.cardData && AppState.cardData.createdAt) {
      data.createdAt = AppState.cardData.createdAt;
    }

    // Step 1: Business Info
    data.businessName = getFieldValue('businessName');
    data.contactName = getFieldValue('contactName');
    data.phone = getFieldValue('phone');
    data.email = getFieldValue('email');
    data.industry = getFieldValue('industry');
    data.website = getFieldValue('website');
    data.address = getFieldValue('address');
    data.city = getFieldValue('city');
    data.state = getFieldValue('state');
    data.zip = getFieldValue('zip');

    // Step 2: Branding
    data.tagline = getFieldValue('tagline');
    data.description = getFieldValue('description');
    data.logo = getFieldValue('logo');
    data.coverPhoto = getFieldValue('coverPhoto');
    data.primaryColor = getFieldValue('primaryColorText') || getFieldValue('primaryColor');
    data.secondaryColor = getFieldValue('secondaryColorText') || getFieldValue('secondaryColor');
    data.accentColor = getFieldValue('accentColorText') || getFieldValue('accentColor');

    // Step 3: Content & Media
    data.hours = getFieldValue('hours');
    data.mediaType = getFieldValue('mediaType');
    data.videoUrl = getFieldValue('videoUrl');
    data.welcomeAudio = getFieldValue('welcomeAudio');
    data.welcomeScript = getFieldValue('welcomeScript');

    // Trust pills / badges
    var trustPillEls = $$('[name="trustPills[]"]');
    data.trustPills = [];
    trustPillEls.forEach(function (el) {
      if (el.checked) data.trustPills.push(el.value);
    });
    var customTrustPill = getFieldValue('customTrustPill');
    if (customTrustPill) {
      data.trustPills.push(customTrustPill);
    }

    // Step 4: Navigation / Tabs
    data.tabPreference = getFieldValue('tabPreference');
    data.customTabs = collectCustomTabs();

    // Step 5: FAQs
    data.faqs = collectFaqs();

    // Step 6: Team & Quick Actions
    data.teamMembers = collectTeamMembers();
    data.enableQuickAction = getFieldValue('enableQuickAction');
    data.quickActionLabel = getFieldValue('quickActionLabel');
    data.quickActionUrl = getFieldValue('quickActionUrl');
    data.quickActionType = getFieldValue('quickActionType');

    // Social links
    data.socialLinks = {};
    var socialFields = ['facebook', 'instagram', 'twitter', 'linkedin', 'youtube', 'tiktok', 'yelp', 'google'];
    socialFields.forEach(function (platform) {
      var val = getFieldValue('social_' + platform);
      if (val) data.socialLinks[platform] = val;
    });

    // Services / categories
    var serviceEls = $$('[name="services[]"]');
    data.services = [];
    serviceEls.forEach(function (el) {
      if (el.checked) data.services.push(el.value);
    });
    var customService = getFieldValue('customService');
    if (customService) {
      data.services.push(customService);
    }

    // Gallery
    var galleryEls = $$('.gallery-url-input');
    data.gallery = [];
    galleryEls.forEach(function (el) {
      var url = el.value.trim();
      if (url) data.gallery.push(url);
    });

    // CTA
    data.ctaLabel = getFieldValue('ctaLabel');
    data.ctaUrl = getFieldValue('ctaUrl');

    // Map computed fields
    data.name = data.businessName;

    return data;
  };

  // ─── Collect dynamic builders ─────────────────────────────────────────────

  function collectCustomTabs() {
    var rows = $$('.custom-tab-row');
    var tabs = [];
    rows.forEach(function (row) {
      var nameInput = row.querySelector('[data-field="tabName"]');
      var emojiInput = row.querySelector('[data-field="tabEmoji"]');
      var typeSelect = row.querySelector('[data-field="tabType"]');
      if (nameInput && nameInput.value.trim()) {
        tabs.push({
          name: nameInput.value.trim(),
          emoji: emojiInput ? emojiInput.value.trim() : '',
          type: typeSelect ? typeSelect.value : 'custom',
        });
      }
    });
    return tabs;
  }

  function collectFaqs() {
    var rows = $$('.faq-row');
    var faqs = [];
    rows.forEach(function (row) {
      var qInput = row.querySelector('[data-field="faqQuestion"]');
      var aInput = row.querySelector('[data-field="faqAnswer"]');
      if (qInput && qInput.value.trim()) {
        faqs.push({
          q: qInput.value.trim(),
          a: aInput ? aInput.value.trim() : '',
        });
      }
    });
    return faqs;
  }

  function collectTeamMembers() {
    var rows = $$('.team-member-row');
    var members = [];
    rows.forEach(function (row) {
      var nameInput = row.querySelector('[data-field="memberName"]');
      var titleInput = row.querySelector('[data-field="memberTitle"]');
      var photoInput = row.querySelector('[data-field="memberPhoto"]');
      var quoteInput = row.querySelector('[data-field="memberQuote"]');
      if (nameInput && nameInput.value.trim()) {
        members.push({
          name: nameInput.value.trim(),
          title: titleInput ? titleInput.value.trim() : '',
          photo: photoInput ? photoInput.value.trim() : '',
          quote: quoteInput ? quoteInput.value.trim() : '',
        });
      }
    });
    return members;
  }

  // ─── 5. Intake.populateForm ───────────────────────────────────────────────

  Intake.populateForm = function (cardData) {
    if (!cardData) return;

    // Step 1
    setFieldValue('businessName', cardData.businessName || cardData.name);
    setFieldValue('contactName', cardData.contactName);
    setFieldValue('phone', cardData.phone);
    setFieldValue('email', cardData.email);
    setFieldValue('industry', cardData.industry);
    setFieldValue('website', cardData.website);
    setFieldValue('address', cardData.address);
    setFieldValue('city', cardData.city);
    setFieldValue('state', cardData.state);
    setFieldValue('zip', cardData.zip);

    // Step 2
    setFieldValue('tagline', cardData.tagline);
    setFieldValue('description', cardData.description);
    setFieldValue('logo', cardData.logo);
    setFieldValue('coverPhoto', cardData.coverPhoto);
    setFieldValue('primaryColor', cardData.primaryColor || '#1e40af');
    setFieldValue('primaryColorText', cardData.primaryColor || '#1e40af');
    setFieldValue('secondaryColor', cardData.secondaryColor || '#f59e0b');
    setFieldValue('secondaryColorText', cardData.secondaryColor || '#f59e0b');
    setFieldValue('accentColor', cardData.accentColor || '#10b981');
    setFieldValue('accentColorText', cardData.accentColor || '#10b981');

    // Step 3
    setFieldValue('hours', cardData.hours);
    setFieldValue('mediaType', cardData.mediaType);
    setFieldValue('videoUrl', cardData.videoUrl);
    setFieldValue('welcomeAudio', cardData.welcomeAudio);
    setFieldValue('welcomeScript', cardData.welcomeScript);

    // Trust pills
    if (Array.isArray(cardData.trustPills)) {
      var trustEls = $$('[name="trustPills[]"]');
      trustEls.forEach(function (el) {
        el.checked = cardData.trustPills.indexOf(el.value) !== -1;
      });
    }

    // Step 4
    setFieldValue('tabPreference', cardData.tabPreference);
    populateCustomTabs(cardData.customTabs);

    // Step 5
    populateFaqs(cardData.faqs);

    // Step 6
    populateTeamMembers(cardData.teamMembers);
    setFieldValue('enableQuickAction', cardData.enableQuickAction);
    setFieldValue('quickActionLabel', cardData.quickActionLabel);
    setFieldValue('quickActionUrl', cardData.quickActionUrl);
    setFieldValue('quickActionType', cardData.quickActionType);

    // Social links
    if (cardData.socialLinks && typeof cardData.socialLinks === 'object') {
      Object.keys(cardData.socialLinks).forEach(function (platform) {
        setFieldValue('social_' + platform, cardData.socialLinks[platform]);
      });
    }

    // Services
    if (Array.isArray(cardData.services)) {
      var serviceEls = $$('[name="services[]"]');
      serviceEls.forEach(function (el) {
        el.checked = cardData.services.indexOf(el.value) !== -1;
      });
    }

    // Gallery
    if (Array.isArray(cardData.gallery)) {
      populateGallery(cardData.gallery);
    }

    // CTA
    setFieldValue('ctaLabel', cardData.ctaLabel);
    setFieldValue('ctaUrl', cardData.ctaUrl);

    // Trigger toggles after population
    triggerToggles();
  };

  // ─── Dynamic list populators ──────────────────────────────────────────────

  function populateCustomTabs(tabs) {
    var container = $('#custom-tabs-container');
    if (!container) return;
    container.innerHTML = '';
    if (!Array.isArray(tabs) || tabs.length === 0) return;

    tabs.forEach(function (tab) {
      addCustomTabRow(tab.name, tab.emoji, tab.type);
    });
  }

  function populateFaqs(faqs) {
    var container = $('#faq-container');
    if (!container) return;
    container.innerHTML = '';
    if (!Array.isArray(faqs) || faqs.length === 0) return;

    faqs.forEach(function (faq) {
      addFaqRow(faq.q, faq.a);
    });
  }

  function populateTeamMembers(members) {
    var container = $('#team-container');
    if (!container) return;
    container.innerHTML = '';
    if (!Array.isArray(members) || members.length === 0) return;

    members.forEach(function (member) {
      addTeamMemberRow(member.name, member.title, member.photo, member.quote);
    });
  }

  function populateGallery(urls) {
    var container = $('#gallery-container');
    if (!container) return;
    container.innerHTML = '';
    if (!Array.isArray(urls) || urls.length === 0) return;

    urls.forEach(function (url) {
      addGalleryRow(url);
    });
  }

  // ─── Dynamic row builders ─────────────────────────────────────────────────

  function addCustomTabRow(name, emoji, type) {
    var container = $('#custom-tabs-container');
    if (!container) return;

    var existing = container.querySelectorAll('.custom-tab-row');
    if (existing.length >= MAX_CUSTOM_TABS) {
      Utils.showToast('Maximum of ' + MAX_CUSTOM_TABS + ' custom tabs allowed.', 'warning');
      return;
    }

    var row = document.createElement('div');
    row.className = 'custom-tab-row';
    row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px;';

    row.innerHTML =
      '<input type="text" data-field="tabName" placeholder="Tab Name" value="' + Utils.escapeHtml(name || '') + '"' +
      ' style="flex:2;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;" />' +
      '<input type="text" data-field="tabEmoji" placeholder="Emoji" value="' + Utils.escapeHtml(emoji || '') + '"' +
      ' style="flex:0 0 60px;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;text-align:center;" maxlength="2" />' +
      '<select data-field="tabType" style="flex:1;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;">' +
      '<option value="services"' + (type === 'services' ? ' selected' : '') + '>Services</option>' +
      '<option value="reviews"' + (type === 'reviews' ? ' selected' : '') + '>Reviews</option>' +
      '<option value="booking"' + (type === 'booking' ? ' selected' : '') + '>Booking</option>' +
      '<option value="faq"' + (type === 'faq' ? ' selected' : '') + '>FAQ</option>' +
      '<option value="gallery"' + (type === 'gallery' ? ' selected' : '') + '>Gallery</option>' +
      '<option value="team"' + (type === 'team' ? ' selected' : '') + '>Team</option>' +
      '<option value="contact"' + (type === 'contact' ? ' selected' : '') + '>Contact</option>' +
      '<option value="about"' + (type === 'about' ? ' selected' : '') + '>About</option>' +
      '<option value="custom"' + (type === 'custom' ? ' selected' : '') + '>Custom</option>' +
      '</select>' +
      '<button type="button" class="remove-row-btn" title="Remove" style="' +
      'flex:0 0 32px;height:32px;background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;border-radius:6px;' +
      'cursor:pointer;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;">&times;</button>';

    container.appendChild(row);

    var removeBtn = row.querySelector('.remove-row-btn');
    listen(removeBtn, 'click', function () {
      row.remove();
      markDirty();
    });

    var inputs = row.querySelectorAll('input, select');
    for (var i = 0; i < inputs.length; i++) {
      listen(inputs[i], 'input', markDirty);
      listen(inputs[i], 'change', markDirty);
    }
  }

  function addFaqRow(question, answer) {
    var container = $('#faq-container');
    if (!container) return;

    var existing = container.querySelectorAll('.faq-row');
    if (existing.length >= MAX_FAQS) {
      Utils.showToast('Maximum of ' + MAX_FAQS + ' FAQ items allowed.', 'warning');
      return;
    }

    var row = document.createElement('div');
    row.className = 'faq-row';
    row.style.cssText = 'border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:8px;background:#f9fafb;';

    row.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
      '<span style="font-weight:600;font-size:13px;color:#374151;">Q&A #' + (existing.length + 1) + '</span>' +
      '<button type="button" class="remove-row-btn" title="Remove" style="' +
      'background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;border-radius:6px;' +
      'cursor:pointer;font-size:14px;padding:2px 8px;">&times;</button>' +
      '</div>' +
      '<input type="text" data-field="faqQuestion" placeholder="Question" value="' + Utils.escapeHtml(question || '') + '"' +
      ' style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;margin-bottom:8px;box-sizing:border-box;" />' +
      '<textarea data-field="faqAnswer" placeholder="Answer" rows="3"' +
      ' style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;resize:vertical;box-sizing:border-box;">' +
      Utils.escapeHtml(answer || '') + '</textarea>';

    container.appendChild(row);

    var removeBtn = row.querySelector('.remove-row-btn');
    listen(removeBtn, 'click', function () {
      row.remove();
      renumberFaqs();
      markDirty();
    });

    var inputs = row.querySelectorAll('input, textarea');
    for (var i = 0; i < inputs.length; i++) {
      listen(inputs[i], 'input', markDirty);
    }
  }

  function renumberFaqs() {
    var rows = $$('.faq-row');
    rows.forEach(function (row, idx) {
      var label = row.querySelector('span');
      if (label) label.textContent = 'Q&A #' + (idx + 1);
    });
  }

  function addTeamMemberRow(name, title, photo, quote) {
    var container = $('#team-container');
    if (!container) return;

    var existing = container.querySelectorAll('.team-member-row');
    if (existing.length >= MAX_TEAM_MEMBERS) {
      Utils.showToast('Maximum of ' + MAX_TEAM_MEMBERS + ' team members allowed.', 'warning');
      return;
    }

    var row = document.createElement('div');
    row.className = 'team-member-row';
    row.style.cssText = 'border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:8px;background:#f9fafb;';

    row.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
      '<span style="font-weight:600;font-size:13px;color:#374151;">Team Member</span>' +
      '<button type="button" class="remove-row-btn" title="Remove" style="' +
      'background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;border-radius:6px;' +
      'cursor:pointer;font-size:14px;padding:2px 8px;">&times;</button>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">' +
      '<input type="text" data-field="memberName" placeholder="Name" value="' + Utils.escapeHtml(name || '') + '"' +
      ' style="padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;" />' +
      '<input type="text" data-field="memberTitle" placeholder="Title / Role" value="' + Utils.escapeHtml(title || '') + '"' +
      ' style="padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;" />' +
      '</div>' +
      '<input type="url" data-field="memberPhoto" placeholder="Photo URL" value="' + Utils.escapeHtml(photo || '') + '"' +
      ' style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;margin-bottom:8px;box-sizing:border-box;" />' +
      '<textarea data-field="memberQuote" placeholder="Quote or bio" rows="2"' +
      ' style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;resize:vertical;box-sizing:border-box;">' +
      Utils.escapeHtml(quote || '') + '</textarea>';

    container.appendChild(row);

    var removeBtn = row.querySelector('.remove-row-btn');
    listen(removeBtn, 'click', function () {
      row.remove();
      markDirty();
    });

    var photoInput = row.querySelector('[data-field="memberPhoto"]');
    listen(photoInput, 'blur', function () {
      showThumbnail(photoInput);
    });

    var inputs = row.querySelectorAll('input, textarea');
    for (var i = 0; i < inputs.length; i++) {
      listen(inputs[i], 'input', markDirty);
    }
  }

  function addGalleryRow(url) {
    var container = $('#gallery-container');
    if (!container) return;

    var row = document.createElement('div');
    row.className = 'gallery-row';
    row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px;';

    row.innerHTML =
      '<input type="url" class="gallery-url-input" placeholder="Image URL" value="' + Utils.escapeHtml(url || '') + '"' +
      ' style="flex:1;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;" />' +
      '<button type="button" class="remove-row-btn" title="Remove" style="' +
      'flex:0 0 32px;height:32px;background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;border-radius:6px;' +
      'cursor:pointer;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;">&times;</button>';

    container.appendChild(row);

    var removeBtn = row.querySelector('.remove-row-btn');
    listen(removeBtn, 'click', function () {
      row.remove();
      markDirty();
    });

    var input = row.querySelector('.gallery-url-input');
    listen(input, 'input', markDirty);
    listen(input, 'blur', function () {
      showThumbnail(input);
    });
  }

  // ─── 6. Intake.saveCard ───────────────────────────────────────────────────

  Intake.saveCard = async function (navigate) {
    try {
      var data = Intake.collectFormData();
      data.status = data.status || 'draft';

      var savedCard = await DB.saveCard(data);
      AppState.currentCardId = savedCard.id;
      AppState.cardData = savedCard;
      AppState.isDirty = false;

      Utils.showToast('Card saved!', 'success');

      if (navigate === 'preview') {
        window.location.hash = '#preview?id=' + savedCard.id;
      } else if (navigate === 'dashboard') {
        window.location.hash = '#dashboard';
      }

      return savedCard;
    } catch (err) {
      console.error('[Intake] saveCard error:', err);
      Utils.showToast('Failed to save card. Please try again.', 'error');
      return null;
    }
  };

  // ─── Show/hide step panels ────────────────────────────────────────────────

  function showStep(step) {
    for (var i = 1; i <= TOTAL_STEPS; i++) {
      var panel = getStepPanel(i);
      if (panel) {
        panel.style.display = i === step ? 'block' : 'none';
        panel.style.transform = '';
        panel.style.opacity = '';
      }
    }
  }

  function resetForm() {
    var form = document.getElementById('intake-form');
    if (form) form.reset();

    // Clear dynamic containers
    var containers = ['#custom-tabs-container', '#faq-container', '#team-container', '#gallery-container'];
    containers.forEach(function (sel) {
      var el = $(sel);
      if (el) el.innerHTML = '';
    });

    // Reset color defaults
    setFieldValue('primaryColor', '#1e40af');
    setFieldValue('primaryColorText', '#1e40af');
    setFieldValue('secondaryColor', '#f59e0b');
    setFieldValue('secondaryColorText', '#f59e0b');
    setFieldValue('accentColor', '#10b981');
    setFieldValue('accentColorText', '#10b981');
  }

  // ─── Trigger toggles for populated forms ──────────────────────────────────

  function triggerToggles() {
    // Tab preference toggle
    var tabPref = getFieldValue('tabPreference');
    var customTabPanel = $('#custom-tab-builder');
    if (customTabPanel) {
      customTabPanel.style.display = tabPref === 'custom' ? '' : 'none';
    }

    // Welcome audio toggle
    var audioToggle = getFieldValue('welcomeAudio');
    var scriptPanel = $('#welcome-script-panel');
    if (scriptPanel) {
      scriptPanel.style.display = audioToggle ? '' : 'none';
    }

    // Quick action toggle
    var qaToggle = getFieldValue('enableQuickAction');
    var qaPanel = $('#quick-action-fields');
    if (qaPanel) {
      qaPanel.style.display = qaToggle ? '' : 'none';
    }

    // Media type toggle
    var mediaType = getFieldValue('mediaType');
    var videoPanel = $('#video-url-panel');
    if (videoPanel) {
      videoPanel.style.display = mediaType === 'video' ? '' : 'none';
    }
  }

  // ─── Bind all event listeners ─────────────────────────────────────────────

  function bindAllListeners() {
    var form = document.getElementById('intake-form');
    if (!form) return;

    // Global input/change listener for auto-sync to AppState
    listen(form, 'input', function (e) {
      if (e.target.matches('input, textarea, select')) {
        markDirty();
      }
    });

    listen(form, 'change', function (e) {
      if (e.target.matches('input, textarea, select')) {
        markDirty();
      }
    });

    // Phone auto-format
    var phoneFields = $$('input[name="phone"]');
    phoneFields.forEach(function (field) {
      listen(field, 'input', function () {
        var pos = field.selectionStart;
        var oldLen = field.value.length;
        field.value = Utils.formatPhone(field.value);
        var newLen = field.value.length;
        var newPos = pos + (newLen - oldLen);
        field.setSelectionRange(Math.max(0, newPos), Math.max(0, newPos));
      });
    });

    // Color picker syncs
    bindColorSync('primaryColor', 'primaryColorText');
    bindColorSync('secondaryColor', 'secondaryColorText');
    bindColorSync('accentColor', 'accentColorText');

    // Logo/photo URL thumbnail on blur
    var urlThumbnailFields = $$('input[name="logo"], input[name="coverPhoto"]');
    urlThumbnailFields.forEach(function (field) {
      listen(field, 'blur', function () {
        showThumbnail(field);
      });
    });

    // Test Link buttons
    var testLinkBtns = $$('[data-action="test-link"]');
    testLinkBtns.forEach(function (btn) {
      listen(btn, 'click', function () {
        var targetName = btn.getAttribute('data-target');
        var url = getFieldValue(targetName);
        if (url) {
          if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
          window.open(url, '_blank', 'noopener');
        } else {
          Utils.showToast('Please enter a URL first.', 'warning');
        }
      });
    });

    // Industry dropdown change -> auto-populate defaults
    var industrySelect = $('[name="industry"]');
    if (industrySelect) {
      listen(industrySelect, 'change', function () {
        var industry = industrySelect.value;
        if (!industry) return;

        var defaults = Utils.getIndustryDefaults(industry);
        if (!defaults) return;

        // Only populate empty fields
        if (!getFieldValue('tagline') && defaults.tagline) {
          setFieldValue('tagline', defaults.tagline);
        }
        if (!getFieldValue('ctaLabel') && defaults.ctaLabel) {
          setFieldValue('ctaLabel', defaults.ctaLabel);
        }
        if (!getFieldValue('mediaType') && defaults.mediaType) {
          setFieldValue('mediaType', defaults.mediaType);
        }

        // Auto-populate trust pills if none selected
        var trustChecked = $$('[name="trustPills[]"]:checked');
        if (trustChecked.length === 0 && Array.isArray(defaults.trustPills)) {
          defaults.trustPills.forEach(function (pill) {
            var el = $('[name="trustPills[]"][value="' + pill + '"]');
            if (el) el.checked = true;
          });
        }

        // Auto-populate custom tabs if empty
        var tabContainer = $('#custom-tabs-container');
        if (tabContainer && tabContainer.children.length === 0 && Array.isArray(defaults.recommendedTabs)) {
          defaults.recommendedTabs.forEach(function (tab) {
            addCustomTabRow(tab.name, tab.icon || '', tab.type);
          });
        }

        // Auto-populate FAQs if empty
        var faqContainer = $('#faq-container');
        if (faqContainer && faqContainer.children.length === 0 && Array.isArray(defaults.faqDefaults)) {
          defaults.faqDefaults.forEach(function (faq) {
            addFaqRow(faq.q, faq.a);
          });
        }

        triggerToggles();
        markDirty();
      });
    }

    // Tab preference radio -> show/hide custom tab builder
    var tabRadios = $$('[name="tabPreference"]');
    tabRadios.forEach(function (radio) {
      listen(radio, 'change', function () {
        var customPanel = $('#custom-tab-builder');
        if (customPanel) {
          customPanel.style.display = radio.value === 'custom' ? '' : 'none';
        }
        markDirty();
      });
    });

    // Add custom tab button
    var addTabBtn = $('#add-custom-tab-btn');
    if (addTabBtn) {
      listen(addTabBtn, 'click', function () {
        addCustomTabRow('', '', 'custom');
      });
    }

    // Add FAQ button
    var addFaqBtn = $('#add-faq-btn');
    if (addFaqBtn) {
      listen(addFaqBtn, 'click', function () {
        addFaqRow('', '');
      });
    }

    // Add team member button
    var addTeamBtn = $('#add-team-btn');
    if (addTeamBtn) {
      listen(addTeamBtn, 'click', function () {
        addTeamMemberRow('', '', '', '');
      });
    }

    // Add gallery image button
    var addGalleryBtn = $('#add-gallery-btn');
    if (addGalleryBtn) {
      listen(addGalleryBtn, 'click', function () {
        addGalleryRow('');
      });
    }

    // Welcome audio toggle -> show/hide script textarea
    var audioToggle = $('[name="welcomeAudio"]');
    if (audioToggle) {
      listen(audioToggle, 'change', function () {
        var panel = $('#welcome-script-panel');
        if (panel) {
          panel.style.display = audioToggle.checked ? '' : 'none';
        }
        markDirty();
      });
    }

    // Welcome script character counter
    bindCharCounter('welcomeScript', MAX_SCRIPT_CHARS);

    // Quick action toggle -> show/hide quick action fields
    var qaToggle = $('[name="enableQuickAction"]');
    if (qaToggle) {
      listen(qaToggle, 'change', function () {
        var panel = $('#quick-action-fields');
        if (panel) {
          panel.style.display = qaToggle.checked ? '' : 'none';
        }
        markDirty();
      });
    }

    // Media type radio -> show/hide video URL field
    var mediaRadios = $$('[name="mediaType"]');
    mediaRadios.forEach(function (radio) {
      listen(radio, 'change', function () {
        var videoPanel = $('#video-url-panel');
        if (videoPanel) {
          videoPanel.style.display = radio.value === 'video' ? '' : 'none';
        }
        markDirty();
      });
    });

    // Navigation: Next/Prev buttons
    var nextBtns = $$('[data-action="next-step"]');
    nextBtns.forEach(function (btn) {
      listen(btn, 'click', function () {
        Intake.goToStep(AppState.currentStep + 1);
      });
    });

    var prevBtns = $$('[data-action="prev-step"]');
    prevBtns.forEach(function (btn) {
      listen(btn, 'click', function () {
        Intake.goToStep(AppState.currentStep - 1);
      });
    });

    // Step indicator clicks
    var indicators = $$('.step-indicator');
    indicators.forEach(function (ind) {
      listen(ind, 'click', function () {
        var target = parseInt(ind.getAttribute('data-step'), 10);
        if (target) Intake.goToStep(target);
      });
    });

    // Save as Draft button
    var saveDraftBtns = $$('[data-action="save-draft"]');
    saveDraftBtns.forEach(function (btn) {
      listen(btn, 'click', function () {
        Intake.saveCard('dashboard');
      });
    });

    // Generate Mock-Up button
    var generateBtns = $$('[data-action="generate-mockup"]');
    generateBtns.forEach(function (btn) {
      listen(btn, 'click', function () {
        Intake.saveCard('preview');
      });
    });
  }

  // ─── Step 7: Review & Generate ────────────────────────────────────────────

  function buildReviewStep() {
    var reviewContainer = $('#review-summary');
    if (!reviewContainer) return;

    var data = Intake.collectFormData();
    var completeness = Utils.calculateCompleteness(data);
    var html = '';

    // Completeness score
    html += '<div class="review-completeness" style="text-align:center;margin-bottom:24px;">';
    html += '<div style="font-size:14px;color:#6b7280;margin-bottom:8px;">Card Completeness</div>';
    html += '<div class="completeness-score" style="font-size:48px;font-weight:700;color:' +
      getScoreColor(completeness.score) + ';" data-target="' + completeness.score + '">0%</div>';
    html += '</div>';

    // Missing items checklist
    if (completeness.missing.length > 0) {
      html += '<div style="background:#fffbeb;border:1px solid #fbbf24;border-radius:8px;padding:12px 16px;margin-bottom:24px;">';
      html += '<div style="font-weight:600;font-size:14px;color:#92400e;margin-bottom:8px;">Missing / Recommended Items</div>';
      html += '<ul style="margin:0;padding-left:20px;font-size:13px;color:#78350f;">';
      completeness.missing.forEach(function (item) {
        html += '<li style="margin-bottom:4px;">' + Utils.escapeHtml(item) + '</li>';
      });
      html += '</ul></div>';
    }

    // Section summaries
    html += buildReviewSection('Business Information', 1, [
      { label: 'Business Name', value: data.businessName },
      { label: 'Contact Name', value: data.contactName },
      { label: 'Phone', value: data.phone },
      { label: 'Email', value: data.email },
      { label: 'Industry', value: data.industry },
      { label: 'Website', value: data.website },
      { label: 'Address', value: formatAddress(data) },
    ]);

    html += buildReviewSection('Branding', 2, [
      { label: 'Tagline', value: data.tagline },
      { label: 'Description', value: data.description ? truncate(data.description, 100) : '' },
      { label: 'Logo', value: data.logo ? 'Provided' : '' },
      { label: 'Cover Photo', value: data.coverPhoto ? 'Provided' : '' },
      { label: 'Primary Color', value: data.primaryColor, isColor: true },
      { label: 'Secondary Color', value: data.secondaryColor, isColor: true },
      { label: 'Accent Color', value: data.accentColor, isColor: true },
    ]);

    html += buildReviewSection('Content & Media', 3, [
      { label: 'Business Hours', value: data.hours },
      { label: 'Media Type', value: data.mediaType },
      { label: 'Video URL', value: data.videoUrl },
      { label: 'Welcome Audio', value: data.welcomeAudio ? 'Enabled' : 'Disabled' },
      { label: 'Trust Badges', value: Array.isArray(data.trustPills) && data.trustPills.length > 0 ? data.trustPills.join(', ') : '' },
    ]);

    html += buildReviewSection('Navigation Tabs', 4, [
      { label: 'Tab Preference', value: data.tabPreference },
      { label: 'Custom Tabs', value: Array.isArray(data.customTabs) && data.customTabs.length > 0 ? data.customTabs.map(function (t) { return t.name; }).join(', ') : '' },
    ]);

    html += buildReviewSection('FAQs', 5, [
      { label: 'FAQ Count', value: Array.isArray(data.faqs) && data.faqs.length > 0 ? data.faqs.length + ' question(s)' : '' },
    ]);

    var teamSummary = [];
    if (Array.isArray(data.teamMembers) && data.teamMembers.length > 0) {
      teamSummary.push({ label: 'Team Members', value: data.teamMembers.map(function (m) { return m.name; }).join(', ') });
    } else {
      teamSummary.push({ label: 'Team Members', value: '' });
    }
    teamSummary.push({ label: 'Quick Action', value: data.enableQuickAction ? (data.quickActionLabel || 'Enabled') : '' });
    teamSummary.push({ label: 'CTA Button', value: data.ctaLabel });

    var socialCount = data.socialLinks ? Object.keys(data.socialLinks).length : 0;
    teamSummary.push({ label: 'Social Links', value: socialCount > 0 ? socialCount + ' connected' : '' });

    html += buildReviewSection('Team & Actions', 6, teamSummary);

    // Action buttons
    html += '<div style="display:flex;gap:12px;margin-top:24px;flex-wrap:wrap;">';
    html += '<button type="button" data-action="generate-mockup" style="' +
      'flex:1;min-width:200px;padding:14px 24px;background:#1e40af;color:#fff;border:none;border-radius:8px;' +
      'font-size:16px;font-weight:600;cursor:pointer;">Generate Mock-Up</button>';
    html += '<button type="button" data-action="save-draft" style="' +
      'flex:1;min-width:200px;padding:14px 24px;background:#f3f4f6;color:#374151;border:1px solid #d1d5db;border-radius:8px;' +
      'font-size:16px;font-weight:600;cursor:pointer;">Save as Draft</button>';
    html += '</div>';

    reviewContainer.innerHTML = html;

    // Bind review action buttons
    var genBtns = reviewContainer.querySelectorAll('[data-action="generate-mockup"]');
    for (var i = 0; i < genBtns.length; i++) {
      listen(genBtns[i], 'click', function () {
        Intake.saveCard('preview');
      });
    }

    var draftBtns = reviewContainer.querySelectorAll('[data-action="save-draft"]');
    for (var j = 0; j < draftBtns.length; j++) {
      listen(draftBtns[j], 'click', function () {
        Intake.saveCard('dashboard');
      });
    }

    // Bind edit links
    var editLinks = reviewContainer.querySelectorAll('[data-action="edit-step"]');
    for (var k = 0; k < editLinks.length; k++) {
      (function (link) {
        listen(link, 'click', function () {
          var step = parseInt(link.getAttribute('data-step'), 10);
          if (step) Intake.goToStep(step);
        });
      })(editLinks[k]);
    }

    // Animate completeness score
    animateScore(completeness.score);
  }

  function buildReviewSection(title, step, items) {
    var hasContent = items.some(function (item) { return !!item.value; });

    var html = '<div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:12px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
    html += '<h3 style="margin:0;font-size:15px;font-weight:600;color:#111827;">' + Utils.escapeHtml(title) + '</h3>';
    html += '<a href="javascript:void(0)" data-action="edit-step" data-step="' + step + '"' +
      ' style="font-size:13px;color:#1e40af;text-decoration:none;font-weight:500;">Edit</a>';
    html += '</div>';

    if (!hasContent) {
      html += '<div style="font-size:13px;color:#9ca3af;font-style:italic;">No data entered yet.</div>';
    } else {
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;">';
      items.forEach(function (item) {
        if (!item.value) return;
        html += '<div style="font-size:13px;">';
        html += '<span style="color:#6b7280;">' + Utils.escapeHtml(item.label) + ':</span> ';
        if (item.isColor && item.value) {
          html += '<span style="display:inline-flex;align-items:center;gap:4px;">';
          html += '<span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:' +
            Utils.escapeHtml(item.value) + ';border:1px solid #d1d5db;vertical-align:middle;"></span> ';
          html += Utils.escapeHtml(item.value);
          html += '</span>';
        } else {
          html += '<span style="color:#111827;font-weight:500;">' + Utils.escapeHtml(item.value) + '</span>';
        }
        html += '</div>';
      });
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  function animateScore(target) {
    var el = document.querySelector('.completeness-score');
    if (!el) return;

    var current = 0;
    var duration = 1200;
    var start = null;

    function frame(timestamp) {
      if (!start) start = timestamp;
      var elapsed = timestamp - start;
      var progress = Math.min(elapsed / duration, 1);

      // Ease out cubic
      var eased = 1 - Math.pow(1 - progress, 3);
      current = Math.round(eased * target);

      el.textContent = current + '%';
      el.style.color = getScoreColor(current);

      if (progress < 1) {
        requestAnimationFrame(frame);
      }
    }

    requestAnimationFrame(frame);
  }

  function getScoreColor(score) {
    if (score >= 80) return '#059669';
    if (score >= 50) return '#d97706';
    return '#dc2626';
  }

  function formatAddress(data) {
    var parts = [data.address, data.city, data.state, data.zip].filter(Boolean);
    return parts.join(', ');
  }

  function truncate(str, max) {
    if (!str) return '';
    if (str.length <= max) return str;
    return str.slice(0, max) + '...';
  }

  // ─── Expose on window ─────────────────────────────────────────────────────

  window.Intake = Intake;

})();
