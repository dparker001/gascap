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

    // Step indicators live OUTSIDE the form, query from the intake view
    var intakeView = document.querySelector('[data-view="intake"]');
    var indicators = intakeView
      ? Array.prototype.slice.call(intakeView.querySelectorAll('.step-indicator'))
      : [];
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

    // Show website callout when navigating to step 2
    if (stepNumber === 2) {
      showWebsiteCallout();
    }

    // Pre-fill scrape URL when navigating to step 6
    if (stepNumber === 6) {
      var ws = getFieldValue('website');
      var scrapeUrl = document.getElementById('scrape-url');
      if (scrapeUrl && ws) scrapeUrl.value = ws;
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
        { name: 'firstName', label: 'First Name' },
        { name: 'lastName', label: 'Last Name' },
        { name: 'phone', label: 'Mobile Phone' },
        { name: 'email', label: 'Email' },
        { name: 'title', label: 'Title / Position' },
        { name: 'businessName', label: 'Business Name' },
        { name: 'website', label: 'Website Address' },
        { name: 'industry', label: 'Industry Type' },
        { name: 'address', label: 'Business Mailing Address' },
        { name: 'city', label: 'City' },
        { name: 'state', label: 'State' },
        { name: 'zip', label: 'Zip Code' },
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

    if (stepNumber === 2) {
      if (!getFieldValue('aboutCompany')) {
        errors.push({ field: 'aboutCompany', message: 'About Company is required.' });
      }
      if (!getFieldValue('servicesOffered')) {
        errors.push({ field: 'servicesOffered', message: 'Services Offered is required.' });
      }
    }

    // Step 3: Media uploads — no blocking required fields (files are optional for draft)

    // Steps 4-6 have no required fields
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

    // Step 1: Contact Details
    data.firstName = getFieldValue('firstName');
    data.middleInitial = getFieldValue('middleInitial');
    data.lastName = getFieldValue('lastName');
    // Compose contactName from parts
    var mi = data.middleInitial ? ' ' + data.middleInitial + '. ' : ' ';
    data.contactName = (data.firstName + mi + data.lastName).trim();
    data.phone = getFieldValue('phone');
    data.email = getFieldValue('email');
    data.title = getFieldValue('title');
    data.businessName = getFieldValue('businessName');
    data.timezone = getFieldValue('timezone');
    data.industryLicense = getFieldValue('industryLicense');
    data.website = getFieldValue('website');
    data.industry = getFieldValue('industry');
    data.address = getFieldValue('address');
    data.city = getFieldValue('city');
    data.state = getFieldValue('state');
    data.zip = getFieldValue('zip');

    // Step 2: Company Info
    data.aboutCompany = getFieldValue('aboutCompany');
    data.servicesOffered = getFieldValue('servicesOffered');
    data.shortBio = getFieldValue('shortBio');
    data.specialty = getFieldValue('specialty');
    // Backwards-compat aliases
    data.tagline = data.specialty;
    data.description = data.aboutCompany;

    // Step 3: Media & Uploads
    data.coverPhoto = getFieldValue('coverPhoto');
    data.logo = getFieldValue('logo');
    data.welcomeAudio = getFieldValue('welcomeAudio');
    data.welcomeScript = getFieldValue('welcomeScript');
    data.miscFile1 = getFieldValue('miscFile1');
    data.miscFile2 = getFieldValue('miscFile2');
    data.miscFile3 = getFieldValue('miscFile3');
    data.miscFile4 = getFieldValue('miscFile4');

    // Step 4: Social Media Links
    data.socialLinks = {};
    var socialFields = ['facebook', 'instagram', 'twitter', 'linkedin', 'youtube', 'tiktok', 'thread', 'snapchat'];
    socialFields.forEach(function (platform) {
      var val = getFieldValue('social_' + platform);
      if (val) data.socialLinks[platform] = val;
    });

    // Step 5: Color Themes & Style
    data.primaryColor = getFieldValue('primaryColorText') || getFieldValue('primaryColor');
    data.accentColor = getFieldValue('accentColorText') || getFieldValue('accentColor');
    data.cardStyle = getFieldValue('cardStyle');
    data.internalNotes = getFieldValue('internalNotes');

    // Step 6: Generated Tabs (stored in AppState)
    if (AppState.cardData && AppState.cardData.generatedTabs) {
      data.generatedTabs = AppState.cardData.generatedTabs;
    }

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

    // Step 1: Contact Details
    setFieldValue('businessName', cardData.businessName || cardData.name);
    setFieldValue('phone', cardData.phone);
    setFieldValue('email', cardData.email);
    setFieldValue('title', cardData.title);
    setFieldValue('industry', cardData.industry);
    setFieldValue('website', cardData.website);
    setFieldValue('address', cardData.address);
    setFieldValue('city', cardData.city);
    setFieldValue('state', cardData.state);
    setFieldValue('zip', cardData.zip);
    setFieldValue('timezone', cardData.timezone);
    setFieldValue('industryLicense', cardData.industryLicense);

    // Split contactName into firstName/lastName if individual fields not saved
    if (cardData.firstName) {
      setFieldValue('firstName', cardData.firstName);
      setFieldValue('middleInitial', cardData.middleInitial);
      setFieldValue('lastName', cardData.lastName);
    } else if (cardData.contactName) {
      var parts = cardData.contactName.split(/\s+/);
      setFieldValue('firstName', parts[0] || '');
      if (parts.length === 3 && parts[1].length <= 2) {
        setFieldValue('middleInitial', parts[1].replace('.', ''));
        setFieldValue('lastName', parts[2] || '');
      } else {
        setFieldValue('lastName', parts.slice(1).join(' '));
      }
    }

    // Step 2: Company Info
    setFieldValue('aboutCompany', cardData.aboutCompany || cardData.description);
    setFieldValue('servicesOffered', cardData.servicesOffered);
    setFieldValue('shortBio', cardData.shortBio);
    setFieldValue('specialty', cardData.specialty || cardData.tagline);

    // Step 3: Media & Uploads
    setFieldValue('coverPhoto', cardData.coverPhoto);
    setFieldValue('logo', cardData.logo);
    setFieldValue('welcomeAudio', cardData.welcomeAudio);
    setFieldValue('welcomeScript', cardData.welcomeScript);
    setFieldValue('miscFile1', cardData.miscFile1);
    setFieldValue('miscFile2', cardData.miscFile2);
    setFieldValue('miscFile3', cardData.miscFile3);
    setFieldValue('miscFile4', cardData.miscFile4);

    // Step 4: Social links
    if (cardData.socialLinks && typeof cardData.socialLinks === 'object') {
      Object.keys(cardData.socialLinks).forEach(function (platform) {
        setFieldValue('social_' + platform, cardData.socialLinks[platform]);
      });
    }

    // Step 5: Color Themes
    setFieldValue('primaryColor', cardData.primaryColor || '#1A2C5B');
    setFieldValue('primaryColorText', cardData.primaryColor || '#1A2C5B');
    setFieldValue('accentColor', cardData.accentColor || '#F47C20');
    setFieldValue('accentColorText', cardData.accentColor || '#F47C20');
    setFieldValue('cardStyle', cardData.cardStyle);
    setFieldValue('internalNotes', cardData.internalNotes);

    // Step 6: Generated Tabs - restore from saved data
    if (Array.isArray(cardData.generatedTabs) && cardData.generatedTabs.length > 0) {
      var container = document.getElementById('generated-tabs-container');
      if (container) {
        container.innerHTML = '';
        cardData.generatedTabs.forEach(function (tab) {
          addGeneratedTab(tab.title, tab.content, tab.type);
        });
        var addBtn = document.getElementById('btn-add-custom-tab');
        if (addBtn) addBtn.style.display = '';
      }
    }

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
    // Pre-fill scrape URL when showing step 6
    if (step === 6) {
      var ws = getFieldValue('website');
      var scrapeUrl = document.getElementById('scrape-url');
      if (scrapeUrl && ws) scrapeUrl.value = ws;
    }
  }

  function resetForm() {
    var form = document.getElementById('intake-form');
    if (form) form.reset();

    // Clear dynamic containers
    var containers = ['#generated-tabs-container'];
    containers.forEach(function (sel) {
      var el = $(sel);
      if (el) el.innerHTML = '<p class="helper-note">Click "Generate Content" to auto-create accordion tabs based on your website and company information.</p>';
    });

    // Hide add custom tab button
    var addBtn = document.getElementById('btn-add-custom-tab');
    if (addBtn) addBtn.style.display = 'none';

    // Reset color defaults
    setFieldValue('primaryColor', '#1A2C5B');
    setFieldValue('primaryColorText', '#1A2C5B');
    setFieldValue('accentColor', '#F47C20');
    setFieldValue('accentColorText', '#F47C20');
  }

  // ─── Trigger toggles for populated forms ──────────────────────────────────

  function triggerToggles() {
    // Custom welcome audio toggle
    var audioToggle = getFieldValue('customWelcomeAudio');
    var scriptPanel = $('#welcome-script-panel');
    if (scriptPanel) {
      scriptPanel.style.display = audioToggle ? '' : 'none';
    }
    // Pitch script toggle
    var pitchToggle = getFieldValue('needPitchScript');
    var pitchPanel = $('#pitch-script-panel');
    if (pitchPanel) {
      pitchPanel.style.display = pitchToggle ? '' : 'none';
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
    bindColorSync('accentColor', 'accentColorText');

    // Custom welcome audio toggle -> show/hide script textarea
    var audioToggle = $('[name="customWelcomeAudio"]');
    if (audioToggle) {
      listen(audioToggle, 'change', function () {
        var panel = $('#welcome-script-panel');
        if (panel) {
          panel.style.display = audioToggle.checked ? '' : 'none';
        }
        markDirty();
      });
    }

    // Pitch script toggle -> show/hide pitch textarea
    var pitchToggle = $('[name="needPitchScript"]');
    if (pitchToggle) {
      listen(pitchToggle, 'change', function () {
        var panel = $('#pitch-script-panel');
        if (panel) {
          panel.style.display = pitchToggle.checked ? '' : 'none';
        }
        markDirty();
      });
    }

    // Welcome script character counter
    bindCharCounter('welcomeScript', 500);

    // Pitch script character counter
    bindCharCounter('pitchScript', 600);

    // File upload zones
    initFileUploads();

    // Address autocomplete
    initAddressLookup();

    // ── Step 6: Content Generation bindings ──
    bindStep6();

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

    // Step indicator clicks (indicators are outside the form, query from intake view)
    var intakeView = document.querySelector('[data-view="intake"]');
    var indicators = intakeView
      ? Array.prototype.slice.call(intakeView.querySelectorAll('.step-indicator'))
      : [];
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

    // ─── "Generate for me" buttons on Step 2 ──────────────────────────────
    bindGenerateButtons();
  }

  // ─── AI Content Generation for Step 2 ─────────────────────────────────────

  function bindGenerateButtons() {
    var btnAbout = document.getElementById('btn-generate-about');
    var btnServices = document.getElementById('btn-generate-services');

    if (btnAbout) {
      btnAbout.addEventListener('click', function () {
        generateFieldFromWebsite('about');
      });
    }
    if (btnServices) {
      btnServices.addEventListener('click', function () {
        generateFieldFromWebsite('services');
      });
    }

    // Show the website callout if a website URL is present
    showWebsiteCallout();
  }

  function showWebsiteCallout() {
    var callout = document.getElementById('step2-website-callout');
    if (!callout) return;
    var website = getFieldValue('website');
    callout.style.display = (website && website !== 'N/A' && website.length > 3) ? 'flex' : 'none';
  }

  function generateFieldFromWebsite(fieldType) {
    var website = getFieldValue('website');
    if (!website || website === 'N/A' || website.length < 4) {
      Utils.showToast('Please enter a website URL in Step 1 first.', 'error');
      return;
    }

    var btn = document.getElementById(fieldType === 'about' ? 'btn-generate-about' : 'btn-generate-services');
    var statusEl = document.getElementById(fieldType === 'about' ? 'generate-status-about' : 'generate-status-services');
    var textarea = document.getElementById(fieldType === 'about' ? 'field-aboutCompany' : 'field-servicesOffered');

    if (!btn || !statusEl || !textarea) return;

    // Show loading state
    btn.classList.add('generating');
    btn.disabled = true;
    statusEl.style.display = 'block';
    statusEl.className = 'generate-status status-loading';
    statusEl.textContent = 'Reviewing website content\u2026';

    // Check if we already scraped this website
    var scraped = window.Scraper && window.Scraper.getScrapedData ? window.Scraper.getScrapedData() : null;

    function processScrapedData(data) {
      if (!data) {
        statusEl.className = 'generate-status status-error';
        statusEl.textContent = 'Could not retrieve content from the website. Please enter the information manually.';
        btn.classList.remove('generating');
        btn.disabled = false;
        return;
      }

      var bizName = getFieldValue('businessName') || 'the company';
      var industry = getFieldValue('industry') || '';
      var generated = '';

      if (fieldType === 'about') {
        generated = buildAboutContent(data, bizName, industry);
      } else {
        generated = buildServicesContent(data, bizName, industry);
      }

      if (generated) {
        textarea.value = generated;
        // Trigger input event so form state updates
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        statusEl.className = 'generate-status status-success';
        statusEl.textContent = 'Content generated from website. Feel free to review and edit.';
      } else {
        statusEl.className = 'generate-status status-error';
        statusEl.textContent = 'Could not find relevant ' + (fieldType === 'about' ? 'company information' : 'service listings') + ' on the website. Please enter manually.';
      }

      btn.classList.remove('generating');
      btn.disabled = false;

      // Auto-hide status after 6 seconds
      setTimeout(function () {
        statusEl.style.display = 'none';
      }, 6000);
    }

    if (scraped) {
      // Already have scraped data, use it directly
      processScrapedData(scraped);
    } else if (window.Scraper && window.Scraper.scrapeWebsite) {
      // Need to scrape first
      statusEl.textContent = 'Scanning website\u2026 this may take a moment.';
      window.Scraper.scrapeWebsite(website).then(function (data) {
        processScrapedData(data);
      }).catch(function () {
        processScrapedData(null);
      });
    } else {
      statusEl.className = 'generate-status status-error';
      statusEl.textContent = 'Website scraper is not available. Please enter the information manually.';
      btn.classList.remove('generating');
      btn.disabled = false;
    }
  }

  function buildAboutContent(scraped, bizName, industry) {
    var parts = [];

    // Use meta description as a starting point
    if (scraped.description) {
      parts.push(scraped.description);
    }

    // Pull from about section if available
    if (scraped.about && scraped.about.length) {
      for (var i = 0; i < Math.min(scraped.about.length, 3); i++) {
        var text = scraped.about[i].trim();
        if (text.length > 30 && parts.indexOf(text) === -1) {
          parts.push(text);
        }
      }
    }

    // Fall back to meaningful paragraphs
    if (parts.length < 2 && scraped.paragraphs && scraped.paragraphs.length) {
      for (var j = 0; j < Math.min(scraped.paragraphs.length, 3); j++) {
        var p = scraped.paragraphs[j].trim();
        if (p.length > 40 && parts.indexOf(p) === -1) {
          parts.push(p);
        }
      }
    }

    // If still nothing, construct from headings and title
    if (parts.length === 0) {
      if (scraped.title) {
        parts.push(bizName + ' \u2014 ' + scraped.title + '.');
      }
      if (industry) {
        parts.push('We are a trusted ' + industry.toLowerCase() + ' company dedicated to providing exceptional service to our clients.');
      }
    }

    return parts.join('\n\n');
  }

  function buildServicesContent(scraped, bizName, industry) {
    var services = [];

    // Pull from scraped services section
    if (scraped.services && scraped.services.length) {
      for (var i = 0; i < scraped.services.length; i++) {
        var svc = scraped.services[i].trim();
        if (svc.length > 3 && svc.length < 200) {
          services.push(svc);
        }
      }
    }

    // Fall back to headings that look like services
    if (services.length === 0 && scraped.headings && scraped.headings.length) {
      var serviceKeywords = /service|solution|offer|product|repair|install|consult|special|treat|clean|maintain/i;
      for (var j = 0; j < scraped.headings.length; j++) {
        var h = scraped.headings[j].trim();
        if (h.length > 3 && h.length < 100 && (serviceKeywords.test(h) || services.length < 8)) {
          services.push(h);
        }
      }
    }

    // Deduplicate
    var unique = [];
    var seen = {};
    for (var k = 0; k < services.length; k++) {
      var key = services[k].toLowerCase();
      if (!seen[key]) {
        seen[key] = true;
        unique.push(services[k]);
      }
    }

    if (unique.length > 0) {
      return unique.join(', ');
    }

    return '';
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
    html += buildReviewSection('Contact Details', 1, [
      { label: 'Name', value: data.contactName },
      { label: 'Title', value: data.title },
      { label: 'Business Name', value: data.businessName },
      { label: 'Phone', value: data.phone },
      { label: 'Email', value: data.email },
      { label: 'Industry', value: data.industry },
      { label: 'Website', value: data.website },
      { label: 'Address', value: formatAddress(data) },
      { label: 'Time Zone', value: data.timezone },
      { label: 'License #', value: data.industryLicense },
    ]);

    html += buildReviewSection('Company Information', 2, [
      { label: 'About', value: data.aboutCompany ? truncate(data.aboutCompany, 100) : '' },
      { label: 'Services', value: data.servicesOffered ? truncate(data.servicesOffered, 100) : '' },
      { label: 'Bio', value: data.shortBio ? truncate(data.shortBio, 80) : '' },
      { label: 'Specialty', value: data.specialty },
    ]);

    html += buildReviewSection('Media & Uploads', 3, [
      { label: 'Profile Photo', value: data.coverPhoto ? 'Provided' : '' },
      { label: 'Logo', value: data.logo ? 'Provided' : '' },
      { label: 'Welcome Audio', value: data.welcomeAudio ? 'Enabled' : 'Disabled' },
      { label: 'Misc Files', value: [data.miscFile1, data.miscFile2, data.miscFile3, data.miscFile4].filter(Boolean).length > 0 ? [data.miscFile1, data.miscFile2, data.miscFile3, data.miscFile4].filter(Boolean).length + ' file(s)' : '' },
    ]);

    var socialCount = data.socialLinks ? Object.keys(data.socialLinks).length : 0;
    html += buildReviewSection('Social Media', 4, [
      { label: 'Social Links', value: socialCount > 0 ? socialCount + ' connected' : '' },
    ]);

    html += buildReviewSection('Color Themes & Style', 5, [
      { label: 'Primary Color', value: data.primaryColor, isColor: true },
      { label: 'Accent Color', value: data.accentColor, isColor: true },
      { label: 'Card Style', value: data.cardStyle },
      { label: 'Notes', value: data.internalNotes ? truncate(data.internalNotes, 80) : '' },
    ]);

    var tabCount = Array.isArray(data.generatedTabs) ? data.generatedTabs.length : 0;
    html += buildReviewSection('Content Generation', 6, [
      { label: 'Accordion Tabs', value: tabCount > 0 ? tabCount + ' tab(s) generated' : 'Not yet generated' },
    ]);

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

  // ─── File Upload Handling ──────────────────────────────────────────────────

  function initFileUploads() {
    var zones = document.querySelectorAll('.file-upload-zone');
    for (var i = 0; i < zones.length; i++) {
      (function (zone) {
        var input = zone.querySelector('input[type="file"]');
        if (!input) return;

        // Drag & drop
        zone.addEventListener('dragover', function (e) {
          e.preventDefault();
          zone.classList.add('dragover');
        });
        zone.addEventListener('dragleave', function () {
          zone.classList.remove('dragover');
        });
        zone.addEventListener('drop', function (e) {
          e.preventDefault();
          zone.classList.remove('dragover');
          if (e.dataTransfer.files.length > 0) {
            input.files = e.dataTransfer.files;
            handleFileSelected(zone, input);
          }
        });

        // Click select
        input.addEventListener('change', function () {
          handleFileSelected(zone, input);
        });
      })(zones[i]);
    }
  }

  function handleFileSelected(zone, input) {
    var file = input.files && input.files[0];
    var previewId = 'upload-preview-' + input.id.replace('field-', '');
    var previewEl = document.getElementById(previewId);
    if (!previewEl) return;

    if (!file) {
      // Reset
      zone.classList.remove('has-file');
      previewEl.innerHTML =
        '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>' +
        '<span>Click to upload or drag & drop</span>';
      return;
    }

    zone.classList.add('has-file');

    // Store as data URL for preview
    var reader = new FileReader();
    reader.onload = function (e) {
      var isImage = file.type.startsWith('image/');
      var html = '';
      if (isImage) {
        html += '<img src="' + e.target.result + '" class="file-upload-thumb" alt="Preview">';
      } else {
        html += '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
      }
      html += '<span class="file-upload-filename">' + _escapeHtml(file.name) + '</span>';
      html += '<span class="file-upload-remove" data-clear="' + input.id + '">Remove</span>';
      previewEl.innerHTML = html;

      // Store data URL on AppState for later use
      if (!AppState.cardData._uploads) AppState.cardData._uploads = {};
      AppState.cardData._uploads[input.name] = {
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl: isImage ? e.target.result : null,
      };

      // Also set the "old" field name for backwards compat with generator
      if (input.name === 'coverPhoto' && isImage) {
        AppState.cardData.coverPhoto = e.target.result;
      }
      if (input.name === 'logo' && isImage) {
        AppState.cardData.logo = e.target.result;
      }

      markDirty();

      // Bind remove
      var removeBtn = previewEl.querySelector('.file-upload-remove');
      if (removeBtn) {
        removeBtn.addEventListener('click', function (evt) {
          evt.stopPropagation();
          evt.preventDefault();
          input.value = '';
          zone.classList.remove('has-file');
          handleFileSelected(zone, input);
          if (AppState.cardData._uploads) delete AppState.cardData._uploads[input.name];
          if (input.name === 'coverPhoto') AppState.cardData.coverPhoto = '';
          if (input.name === 'logo') AppState.cardData.logo = '';
          markDirty();
        });
      }
    };
    reader.readAsDataURL(file);
  }

  // ─── Address Autocomplete (Nominatim) ─────────────────────────────────────

  var _addressDebounce = null;

  function initAddressLookup() {
    var addressField = document.getElementById('field-address');
    var suggestionsEl = document.getElementById('address-suggestions');
    if (!addressField || !suggestionsEl) return;

    addressField.addEventListener('input', function () {
      var query = addressField.value.trim();
      if (query.length < 4) {
        suggestionsEl.style.display = 'none';
        return;
      }

      clearTimeout(_addressDebounce);
      _addressDebounce = setTimeout(function () {
        fetchAddressSuggestions(query, suggestionsEl, addressField);
      }, 400);
    });

    // Close suggestions on click outside
    document.addEventListener('click', function (e) {
      if (!addressField.contains(e.target) && !suggestionsEl.contains(e.target)) {
        suggestionsEl.style.display = 'none';
      }
    });
  }

  async function fetchAddressSuggestions(query, suggestionsEl, addressField) {
    try {
      var url = 'https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=us&limit=5&q=' + encodeURIComponent(query);
      var response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      var results = await response.json();

      if (!results || results.length === 0) {
        suggestionsEl.style.display = 'none';
        return;
      }

      var html = '';
      for (var i = 0; i < results.length; i++) {
        var r = results[i];
        var addr = r.address || {};
        var mainLine = r.display_name.split(',').slice(0, 2).join(',');
        var secondLine = r.display_name.split(',').slice(2).join(',').trim();

        html += '<div class="address-suggestion-item" data-idx="' + i + '"' +
          ' data-street="' + _escapeAttr((addr.house_number ? addr.house_number + ' ' : '') + (addr.road || '')) + '"' +
          ' data-city="' + _escapeAttr(addr.city || addr.town || addr.village || addr.hamlet || '') + '"' +
          ' data-state="' + _escapeAttr(addr.state || '') + '"' +
          ' data-zip="' + _escapeAttr(addr.postcode || '') + '"' +
          '>' +
          '<div class="suggestion-main">' + _escapeHtml(mainLine) + '</div>' +
          '<div class="suggestion-secondary">' + _escapeHtml(secondLine) + '</div>' +
          '</div>';
      }

      suggestionsEl.innerHTML = html;
      suggestionsEl.style.display = '';

      // Bind click handlers
      var items = suggestionsEl.querySelectorAll('.address-suggestion-item');
      for (var j = 0; j < items.length; j++) {
        items[j].addEventListener('click', function () {
          var street = this.getAttribute('data-street');
          var city = this.getAttribute('data-city');
          var state = this.getAttribute('data-state');
          var zip = this.getAttribute('data-zip');

          // Map state name to abbreviation
          var stateAbbr = getStateAbbreviation(state) || state;

          addressField.value = street;
          setFieldValue('city', city);
          setFieldValue('state', stateAbbr);
          setFieldValue('zip', zip);

          suggestionsEl.style.display = 'none';
          markDirty();
        });
      }
    } catch (err) {
      console.log('[Intake] Address lookup failed:', err.message);
      suggestionsEl.style.display = 'none';
    }
  }

  function getStateAbbreviation(stateName) {
    var states = {
      'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA',
      'Colorado':'CO','Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA',
      'Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA',
      'Kansas':'KS','Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD',
      'Massachusetts':'MA','Michigan':'MI','Minnesota':'MN','Mississippi':'MS','Missouri':'MO',
      'Montana':'MT','Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ',
      'New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH',
      'Oklahoma':'OK','Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC',
      'South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT',
      'Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY',
      'District of Columbia':'DC',
    };
    return states[stateName] || null;
  }

  // ─── Step 6: Content Generation Helpers ────────────────────────────────────

  function bindStep6() {
    // Scrape button
    var scrapeBtn = document.getElementById('btn-scrape-website');
    if (scrapeBtn) {
      listen(scrapeBtn, 'click', async function () {
        var url = document.getElementById('scrape-url').value.trim();
        if (!url || url === 'N/A') {
          showScrapeStatus('Please enter a valid website URL in Step 1.', 'error');
          return;
        }

        showScrapeStatus('Scraping website content...', 'loading');
        document.getElementById('scrape-btn-text').style.display = 'none';
        document.getElementById('scrape-spinner').style.display = '';

        try {
          var data = await window.Scraper.scrapeWebsite(url);
          document.getElementById('scrape-btn-text').style.display = '';
          document.getElementById('scrape-spinner').style.display = 'none';

          if (data) {
            showScrapeStatus('Successfully scraped ' + (data.paragraphs.length + data.headings.length) + ' content elements from ' + data.title, 'success');
            showScrapedPreview(data);
          } else {
            showScrapeStatus('Could not fetch website. Content will be generated from your form inputs instead.', 'error');
          }
        } catch (err) {
          document.getElementById('scrape-btn-text').style.display = '';
          document.getElementById('scrape-spinner').style.display = 'none';
          showScrapeStatus('Scraping failed: ' + err.message + '. Content will be generated from your form inputs.', 'error');
        }
      });
    }

    // Generate content button
    var genBtn = document.getElementById('btn-generate-content');
    if (genBtn) {
      listen(genBtn, 'click', function () {
        generateAccordionTabs();
      });
    }

    // Add custom tab button
    var addTabBtn = document.getElementById('btn-add-custom-tab');
    if (addTabBtn) {
      listen(addTabBtn, 'click', function () {
        addGeneratedTab('New Tab', 'Enter your content here...', 'custom');
        storeGeneratedTabs();
      });
    }
  }

  function showScrapeStatus(msg, type) {
    var el = document.getElementById('scrape-status');
    if (!el) return;
    el.style.display = '';
    el.className = 'scrape-status ' + type;
    el.textContent = msg;
  }

  function showScrapedPreview(data) {
    var container = document.getElementById('scraped-content-preview');
    var body = document.getElementById('scraped-content-body');
    if (!container || !body) return;

    container.style.display = '';
    var html = '';

    if (data.title) {
      html += '<div class="scraped-section"><div class="scraped-label">Page Title</div>' + _escapeHtml(data.title) + '</div>';
    }
    if (data.description) {
      html += '<div class="scraped-section"><div class="scraped-label">Meta Description</div>' + _escapeHtml(data.description) + '</div>';
    }
    if (data.headings.length > 0) {
      html += '<div class="scraped-section"><div class="scraped-label">Key Headings (' + data.headings.length + ')</div>' + data.headings.slice(0, 8).map(function(h) { return _escapeHtml(h); }).join(' &bull; ') + '</div>';
    }
    if (data.services.length > 0) {
      html += '<div class="scraped-section"><div class="scraped-label">Services Found (' + data.services.length + ')</div>' + data.services.map(function(s) { return _escapeHtml(s); }).join(', ') + '</div>';
    }
    if (data.paragraphs.length > 0) {
      html += '<div class="scraped-section"><div class="scraped-label">Content Paragraphs (' + data.paragraphs.length + ')</div>' + _escapeHtml(data.paragraphs[0].substring(0, 200)) + '...</div>';
    }
    if (data.faqs.length > 0) {
      html += '<div class="scraped-section"><div class="scraped-label">FAQs Found (' + data.faqs.length + ')</div>' + data.faqs.slice(0, 3).map(function(f) { return 'Q: ' + _escapeHtml(f.q); }).join('<br>') + '</div>';
    }

    body.innerHTML = html;
  }

  function _escapeHtml(str) {
    if (!str) return '';
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(String(str)));
    return d.innerHTML;
  }

  function _escapeAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function generateAccordionTabs() {
    var scraped = window.Scraper ? window.Scraper.getScrapedData() : null;

    // Collect form data for generation
    var firstName = getFieldValue('firstName') || '';
    var lastName = getFieldValue('lastName') || '';
    var contactName = (firstName + ' ' + lastName).trim();

    var tabs = window.Scraper.generateTabContent({
      scraped: scraped,
      businessName: getFieldValue('businessName') || '',
      aboutCompany: getFieldValue('aboutCompany') || '',
      servicesOffered: getFieldValue('servicesOffered') || '',
      shortBio: getFieldValue('shortBio') || '',
      industry: getFieldValue('industry') || '',
      website: getFieldValue('website') || '',
      contactName: contactName,
      phone: getFieldValue('phone') || '',
      email: getFieldValue('email') || '',
    });

    // Render tabs
    var container = document.getElementById('generated-tabs-container');
    if (!container) return;
    container.innerHTML = '';

    for (var i = 0; i < tabs.length; i++) {
      addGeneratedTab(tabs[i].title, tabs[i].content, tabs[i].type);
    }

    // Show add button
    var addBtn = document.getElementById('btn-add-custom-tab');
    if (addBtn) addBtn.style.display = '';

    // Store in card data
    storeGeneratedTabs();

    Utils.showToast(tabs.length + ' accordion tabs generated!', 'success');
  }

  var _tabCounter = 0;

  function addGeneratedTab(title, content, type) {
    var container = document.getElementById('generated-tabs-container');
    if (!container) return;

    _tabCounter++;
    var id = 'gen-tab-' + _tabCounter;

    var item = document.createElement('div');
    item.className = 'generated-tab-item';
    item.setAttribute('data-tab-id', id);
    item.setAttribute('data-tab-type', type || 'custom');

    item.innerHTML =
      '<div class="generated-tab-header">' +
      '<input type="text" value="' + _escapeAttr(title) + '" class="tab-title-input" placeholder="Tab Title">' +
      '<button type="button" class="btn btn-sm btn-remove-tab" data-remove="' + id + '">Remove</button>' +
      '</div>' +
      '<textarea class="tab-content-input" placeholder="Tab content...">' + _escapeHtml(content) + '</textarea>';

    container.appendChild(item);

    // Bind remove
    var removeBtn = item.querySelector('[data-remove]');
    if (removeBtn) {
      removeBtn.addEventListener('click', function () {
        item.remove();
        storeGeneratedTabs();
      });
    }

    // Bind change tracking
    var titleInput = item.querySelector('.tab-title-input');
    var contentInput = item.querySelector('.tab-content-input');
    if (titleInput) titleInput.addEventListener('input', function () { storeGeneratedTabs(); });
    if (contentInput) contentInput.addEventListener('input', function () { storeGeneratedTabs(); });
  }

  function storeGeneratedTabs() {
    var container = document.getElementById('generated-tabs-container');
    if (!container) return;

    var items = container.querySelectorAll('.generated-tab-item');
    var tabs = [];
    for (var i = 0; i < items.length; i++) {
      var titleEl = items[i].querySelector('.tab-title-input');
      var contentEl = items[i].querySelector('.tab-content-input');
      tabs.push({
        title: titleEl ? titleEl.value.trim() : '',
        content: contentEl ? contentEl.value.trim() : '',
        type: items[i].getAttribute('data-tab-type') || 'custom',
      });
    }

    AppState.cardData.generatedTabs = tabs;
    AppState.isDirty = true;
  }

  // ─── Expose on window ─────────────────────────────────────────────────────

  window.Intake = Intake;

})();
