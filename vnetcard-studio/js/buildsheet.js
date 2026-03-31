/**
 * vNetCard Studio - VE Build Sheet Module
 *
 * Document-style view displaying all card data organized for a Virtual
 * Executive to build the actual vNetCard. Provides HTML rendering, PDF
 * export via jsPDF, plain-text clipboard copy, and print support.
 * Exposes a global `window.BuildSheet` object.
 *
 * (c) vNetCard - All rights reserved.
 */

(function () {
  'use strict';

  var BuildSheet = {};

  // ─── HELPERS ──────────────────────────────────────────────────────────────

  /**
   * Escape HTML entities in a string.
   */
  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Format an ISO date string to a human-readable form.
   */
  function formatDate(iso) {
    if (!iso) return 'N/A';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return 'N/A';
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  /**
   * Return a status badge HTML string.
   */
  function statusBadge(status) {
    var label = (status || 'draft').charAt(0).toUpperCase() + (status || 'draft').slice(1);
    var colorMap = {
      draft: '#6b7280',
      'in-progress': '#f59e0b',
      review: '#3b82f6',
      completed: '#10b981',
      delivered: '#8b5cf6',
    };
    var bg = colorMap[status] || '#6b7280';
    return '<span style="display:inline-block;padding:4px 12px;border-radius:12px;' +
      'background:' + bg + ';color:#fff;font-size:13px;font-weight:600;">' +
      esc(label) + '</span>';
  }

  /**
   * Build a simple two-column table from an array of [label, value] pairs.
   */
  function infoTable(rows) {
    var html = '<table style="width:100%;border-collapse:collapse;margin:12px 0 20px;">';
    for (var i = 0; i < rows.length; i++) {
      var bg = i % 2 === 0 ? '#f9fafb' : '#ffffff';
      html += '<tr style="background:' + bg + ';">' +
        '<td style="padding:10px 14px;border:1px solid #e5e7eb;font-weight:600;width:200px;color:#374151;">' +
        esc(rows[i][0]) + '</td>' +
        '<td style="padding:10px 14px;border:1px solid #e5e7eb;color:#1f2937;">' +
        (rows[i][1] || '<span style="color:#9ca3af;">Not provided</span>') + '</td></tr>';
    }
    html += '</table>';
    return html;
  }

  /**
   * Build a table with a header row and data rows.
   */
  function dataTable(headers, rows) {
    var html = '<table style="width:100%;border-collapse:collapse;margin:12px 0 20px;">';
    html += '<tr>';
    for (var h = 0; h < headers.length; h++) {
      html += '<th style="padding:10px 14px;border:1px solid #e5e7eb;background:#1e293b;' +
        'color:#fff;font-weight:600;text-align:left;font-size:13px;">' +
        esc(headers[h]) + '</th>';
    }
    html += '</tr>';
    for (var r = 0; r < rows.length; r++) {
      var bg = r % 2 === 0 ? '#f9fafb' : '#ffffff';
      html += '<tr style="background:' + bg + ';">';
      for (var c = 0; c < rows[r].length; c++) {
        html += '<td style="padding:10px 14px;border:1px solid #e5e7eb;color:#1f2937;' +
          'font-size:13px;vertical-align:top;">' + (rows[r][c] || '') + '</td>';
      }
      html += '</tr>';
    }
    html += '</table>';
    return html;
  }

  /**
   * Section heading.
   */
  function sectionHeading(num, title) {
    return '<h3 style="margin:28px 0 8px;padding-bottom:6px;border-bottom:2px solid #1e293b;' +
      'font-size:16px;color:#1e293b;font-weight:700;">Section ' + num + ' &mdash; ' +
      esc(title) + '</h3>';
  }

  /**
   * Determine an asset status string.
   */
  function assetStatus(value, label) {
    if (!value) return '<span style="color:#ef4444;">&#x26A0;&#xFE0F; Missing</span>';
    if (typeof value === 'string' && value.trim() === '') {
      return '<span style="color:#ef4444;">&#x26A0;&#xFE0F; Missing</span>';
    }
    return '<span style="color:#10b981;">&#x2705; ' + esc(label || 'Provided') + '</span>';
  }

  /**
   * Check if a feature is enabled in card data.
   */
  function hasFeature(cardData, feature) {
    if (!cardData.features || !Array.isArray(cardData.features)) return false;
    return cardData.features.indexOf(feature) !== -1;
  }

  /**
   * Get social platform names that have URLs.
   */
  function getSocialPlatforms(cardData) {
    var links = cardData.socialLinks;
    if (!links || typeof links !== 'object') return [];
    var platforms = [];
    var keys = Object.keys(links);
    for (var i = 0; i < keys.length; i++) {
      if (links[keys[i]] && String(links[keys[i]]).trim() !== '') {
        platforms.push(keys[i].charAt(0).toUpperCase() + keys[i].slice(1));
      }
    }
    return platforms;
  }

  /**
   * Get custom tabs from card data.
   */
  function getCustomTabs(cardData) {
    if (cardData.customTabs && Array.isArray(cardData.customTabs)) return cardData.customTabs;
    if (cardData.recommendedTabs && Array.isArray(cardData.recommendedTabs)) return cardData.recommendedTabs;
    return [];
  }

  // ─── 1. INIT ──────────────────────────────────────────────────────────────

  /**
   * Initialize the build sheet view. Loads card data from DB using the
   * current card id from AppState, renders all sections, and sets up
   * export controls.
   */
  BuildSheet.init = async function (cardId) {
    var id = cardId || (window.AppState && window.AppState.currentCardId) || null;

    if (!id) {
      var container = document.getElementById('buildsheet-content');
      if (container) {
        container.innerHTML = '<div style="padding:40px;text-align:center;color:#6b7280;">' +
          '<p style="font-size:18px;font-weight:600;">No card selected</p>' +
          '<p>Navigate to a card and open the build sheet from its menu.</p></div>';
      }
      return;
    }

    try {
      var cardData = await DB.getCard(id);
      if (!cardData) {
        var container2 = document.getElementById('buildsheet-content');
        if (container2) {
          container2.innerHTML = '<div style="padding:40px;text-align:center;color:#ef4444;">' +
            '<p style="font-size:18px;font-weight:600;">Card not found</p>' +
            '<p>The requested card (ID: ' + esc(String(id)) + ') could not be loaded.</p></div>';
        }
        return;
      }

      BuildSheet.render(cardData);
      setupExportControls(cardData);
    } catch (err) {
      console.error('[BuildSheet] Init error:', err);
    }
  };

  /**
   * Wire up export button event listeners.
   */
  function setupExportControls(cardData) {
    var pdfBtn = document.getElementById('buildsheet-export-pdf');
    var copyBtn = document.getElementById('buildsheet-copy-text');
    var printBtn = document.getElementById('buildsheet-print');

    if (pdfBtn) {
      pdfBtn.onclick = function () {
        BuildSheet.exportPDF(cardData);
      };
    }
    if (copyBtn) {
      copyBtn.onclick = function () {
        BuildSheet.copyAsText(cardData);
      };
    }
    if (printBtn) {
      printBtn.onclick = function () {
        BuildSheet.print();
      };
    }
  }

  // ─── 2. RENDER ────────────────────────────────────────────────────────────

  /**
   * Generate the complete build sheet HTML and inject into #buildsheet-content.
   */
  BuildSheet.render = function (cardData) {
    var container = document.getElementById('buildsheet-content');
    if (!container) {
      console.warn('[BuildSheet] Container #buildsheet-content not found.');
      return;
    }

    var html = '';

    // ── HEADER ──
    html += renderHeader(cardData);

    // ── EXPORT CONTROLS ──
    html += renderExportBar();

    // ── SECTION 1: Client Overview ──
    html += sectionHeading(1, 'Client Overview');
    html += renderClientOverview(cardData);

    // ── SECTION 2: Card Section Specs ──
    html += sectionHeading(2, 'Card Section Specs');
    html += renderSectionSpecs(cardData);

    // ── SECTION 3: Asset Collection Checklist ──
    html += sectionHeading(3, 'Asset Collection Checklist');
    html += renderAssetChecklist(cardData);

    // ── SECTION 4: Custom Tabs Spec ──
    html += sectionHeading(4, 'Custom Tabs Spec');
    html += renderCustomTabsSpec(cardData);

    // ── SECTION 5: Branding Spec ──
    html += sectionHeading(5, 'Branding Spec');
    html += renderBrandingSpec(cardData);

    // ── SECTION 6: Automation/Integration Notes ──
    html += sectionHeading(6, 'Automation / Integration Notes');
    html += renderAutomationNotes(cardData);

    // ── SECTION 7: Build Status Summary ──
    html += sectionHeading(7, 'Build Status Summary');
    html += renderBuildStatus(cardData);

    // ── SECTION 8: Internal Notes ──
    html += sectionHeading(8, 'Internal Notes');
    html += renderInternalNotes(cardData);

    container.innerHTML = '<div style="max-width:900px;margin:0 auto;padding:24px 20px 60px;' +
      'font-family:\'Inter\',\'Segoe UI\',system-ui,sans-serif;">' + html + '</div>';
  };

  /**
   * Render the build sheet header block.
   */
  function renderHeader(cardData) {
    return '<div style="text-align:center;padding:20px 0 24px;border-bottom:3px solid #1e293b;margin-bottom:24px;">' +
      '<p style="margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:2px;color:#64748b;">' +
      'vNetCard&trade; VE Build Sheet</p>' +
      '<h1 style="margin:0 0 10px;font-size:28px;color:#0f172a;">' +
      esc(cardData.businessName || 'Untitled Card') + '</h1>' +
      '<p style="margin:0 0 10px;font-size:14px;color:#64748b;">Generated: ' +
      formatDate(new Date().toISOString()) + '</p>' +
      '<div style="margin:0 0 10px;">' + statusBadge(cardData.status) + '</div>' +
      '<p style="margin:0;font-size:14px;color:#374151;">VE Assigned: ' +
      '<span contenteditable="true" style="border-bottom:1px dashed #94a3b8;padding:2px 8px;' +
      'min-width:120px;display:inline-block;outline:none;color:#0f172a;font-weight:600;" ' +
      'data-placeholder="Click to assign">' +
      esc(cardData.veAssigned || '') + '</span></p>' +
      '</div>';
  }

  /**
   * Render the export controls toolbar.
   */
  function renderExportBar() {
    var btnStyle = 'display:inline-flex;align-items:center;gap:6px;padding:8px 16px;' +
      'border-radius:6px;border:1px solid #d1d5db;background:#fff;color:#374151;' +
      'font-size:13px;font-weight:500;cursor:pointer;transition:background 0.15s;';
    return '<div style="display:flex;gap:10px;justify-content:flex-end;margin:0 0 20px;flex-wrap:wrap;">' +
      '<button id="buildsheet-export-pdf" style="' + btnStyle + '">&#128196; Export PDF</button>' +
      '<button id="buildsheet-copy-text" style="' + btnStyle + '">&#128203; Copy as Text</button>' +
      '<button id="buildsheet-print" style="' + btnStyle + '">&#128424; Print</button>' +
      '</div>';
  }

  /**
   * Section 1 - Client Overview table.
   */
  function renderClientOverview(cardData) {
    return infoTable([
      ['Business Name', esc(cardData.businessName || '')],
      ['Contact Name', esc(cardData.contactName || '')],
      ['Title', esc(cardData.contactTitle || '')],
      ['Phone', esc(cardData.phone || '')],
      ['Email', esc(cardData.email || '')],
      ['Website', cardData.website
        ? '<a href="' + esc(cardData.website) + '" target="_blank" style="color:#2563eb;">' +
          esc(cardData.website) + '</a>'
        : ''],
      ['Industry', esc(cardData.industry || '')],
      ['Service Area', esc(cardData.serviceArea || '')],
    ]);
  }

  /**
   * Section 2 - Card Section Specs table.
   */
  function renderSectionSpecs(cardData) {
    var socialPlatforms = getSocialPlatforms(cardData);
    var tabs = getCustomTabs(cardData);
    var tabNames = tabs.map(function (t) { return t.name || t.label || 'Unnamed'; }).join(', ');
    var tabTypes = tabs.map(function (t) { return t.type || 'custom'; }).join(', ');

    var rows = [
      // Hero
      [
        'Hero',
        'Primary: ' + esc(cardData.primaryColor || 'Not set') +
        ' / Accent: ' + esc(cardData.accentColor || 'Not set'),
        assetStatus(cardData.logo, 'Logo uploaded') + '<br>' +
        assetStatus(cardData.profilePhoto, 'Profile photo') + '<br>' +
        assetStatus(cardData.heroImage, 'Hero image'),
        esc(cardData.heroNotes || ''),
      ],
      // Contact Actions
      [
        'Contact Actions',
        'Call: ' + esc(cardData.callLabel || 'Call') +
        ' | Text: ' + esc(cardData.textLabel || 'Text') +
        ' | Email: ' + esc(cardData.emailLabel || 'Email'),
        'Phone: ' + assetStatus(cardData.phone, 'Set') + '<br>' +
        'Email: ' + assetStatus(cardData.email, 'Set'),
        '',
      ],
      // Utility Buttons
      [
        'Utility Buttons',
        'Standard &mdash; No customization needed',
        '<span style="color:#10b981;">&#x2705; Ready</span>',
        '',
      ],
      // Welcome Audio
      [
        'Welcome Audio',
        cardData.welcomeAudioEnabled
          ? esc(cardData.welcomeAudioScript || 'Script not provided')
          : '<span style="color:#9ca3af;">Disabled</span>',
        cardData.welcomeAudioEnabled
          ? assetStatus(cardData.welcomeAudioScript, 'Script provided')
          : '<span style="color:#9ca3af;">N/A</span>',
        '',
      ],
      // Media
      [
        'Media',
        'Type: ' + esc(cardData.mediaType || 'Not selected'),
        cardData.mediaType === 'video'
          ? assetStatus(cardData.videoUrl, 'Video URL provided')
          : cardData.mediaType === 'gallery'
            ? assetStatus(
              cardData.gallery && cardData.gallery.length > 0 ? 'yes' : '',
              (cardData.gallery ? cardData.gallery.length : 0) + ' photo(s)')
            : '<span style="color:#9ca3af;">N/A</span>',
        cardData.mediaType === 'video' && cardData.videoUrl
          ? '<a href="' + esc(cardData.videoUrl) + '" target="_blank" style="color:#2563eb;font-size:12px;">' +
            esc(cardData.videoUrl) + '</a>'
          : '',
      ],
      // Custom Tabs
      [
        'Custom Tabs',
        tabNames || '<span style="color:#9ca3af;">None configured</span>',
        tabs.length > 0
          ? '<span style="color:#10b981;">&#x2705; ' + tabs.length + ' tab(s)</span>'
          : '<span style="color:#ef4444;">&#x26A0;&#xFE0F; None</span>',
        tabTypes ? 'Types: ' + esc(tabTypes) : '',
      ],
      // Social Media
      [
        'Social Media',
        socialPlatforms.length > 0
          ? socialPlatforms.join(', ')
          : '<span style="color:#9ca3af;">None provided</span>',
        socialPlatforms.length > 0
          ? '<span style="color:#10b981;">&#x2705; ' + socialPlatforms.length + ' platform(s)</span>'
          : '<span style="color:#ef4444;">&#x26A0;&#xFE0F; Missing</span>',
        '',
      ],
      // Footer
      [
        'Footer',
        'Tagline: ' + esc(cardData.footerTagline || 'Not set') +
        '<br>License: ' + esc(cardData.license || 'Not provided'),
        assetStatus(cardData.footerTagline, 'Tagline set'),
        '',
      ],
      // Powered By
      [
        'Powered By',
        'Standard',
        '<span style="color:#10b981;">&#x2705; Ready</span>',
        '',
      ],
    ];

    return dataTable(['Section Name', 'Content / Copy', 'Asset Status', 'Notes'], rows);
  }

  /**
   * Section 3 - Asset Collection Checklist.
   */
  function renderAssetChecklist(cardData) {
    var items = [
      { label: 'Logo file', check: cardData.logo },
      { label: 'Profile photo', check: cardData.profilePhoto },
      { label: 'Hero / background image', check: cardData.heroImage },
      {
        label: 'Gallery photos',
        check: hasFeature(cardData, 'gallery') ? (cardData.gallery && cardData.gallery.length > 0) : null,
      },
      {
        label: 'Video URL',
        check: cardData.mediaType === 'video' ? cardData.videoUrl : null,
      },
      {
        label: 'Social media links',
        check: getSocialPlatforms(cardData).length > 0,
      },
      {
        label: 'Testimonials / reviews content',
        check: hasFeature(cardData, 'reviews')
          ? (cardData.reviews && cardData.reviews.length > 0)
          : null,
      },
      {
        label: 'Services list',
        check: hasFeature(cardData, 'services') || (cardData.services && cardData.services.length > 0)
          ? (cardData.services && cardData.services.length > 0)
          : null,
      },
      {
        label: 'FAQ content',
        check: hasFeature(cardData, 'faqs')
          ? (cardData.faqs && cardData.faqs.length > 0)
          : null,
      },
      {
        label: 'Team member info',
        check: hasFeature(cardData, 'team')
          ? (cardData.team && cardData.team.length > 0)
          : null,
      },
    ];

    var html = '<div style="margin:12px 0 20px;">';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      // null means not applicable
      if (item.check === null) continue;
      var isOk = !!item.check;
      html += '<div style="padding:8px 14px;border-bottom:1px solid #e5e7eb;display:flex;' +
        'align-items:center;gap:10px;font-size:14px;">' +
        '<span style="font-size:16px;">' + (isOk ? '&#x2705;' : '&#x26A0;&#xFE0F;') + '</span>' +
        '<span style="color:' + (isOk ? '#059669' : '#dc2626') + ';font-weight:' +
        (isOk ? '500' : '600') + ';">' +
        esc(item.label) + ' &mdash; ' + (isOk ? 'Confirmed' : 'Missing') +
        '</span></div>';
    }
    html += '</div>';
    return html;
  }

  /**
   * Section 4 - Custom Tabs Spec table.
   */
  function renderCustomTabsSpec(cardData) {
    var tabs = getCustomTabs(cardData);
    if (tabs.length === 0) {
      return '<p style="color:#6b7280;font-size:14px;margin:12px 0;">No custom tabs configured.</p>';
    }

    var rows = [];
    for (var i = 0; i < tabs.length; i++) {
      var tab = tabs[i];
      rows.push([
        esc(tab.name || tab.label || 'Tab ' + (i + 1)),
        esc(tab.type || 'custom'),
        esc(tab.ctaText || tab.ctaLabel || 'N/A'),
        esc(tab.link || tab.action || tab.url || 'Needs setup'),
      ]);
    }

    return dataTable(['Tab Name', 'Content Type', 'CTA Text', 'Link / Action Needed'], rows);
  }

  /**
   * Section 5 - Branding Spec.
   */
  function renderBrandingSpec(cardData) {
    var primary = cardData.primaryColor || '#000000';
    var accent = cardData.accentColor || '#666666';

    function colorSwatch(hex) {
      return '<span style="display:inline-block;width:24px;height:24px;border-radius:4px;' +
        'border:1px solid #d1d5db;background:' + esc(hex) + ';vertical-align:middle;margin-right:8px;"></span>' +
        '<code style="font-size:13px;color:#374151;">' + esc(hex) + '</code>';
    }

    var logoRow = 'Status: ' + (cardData.logo
      ? '<span style="color:#059669;font-weight:500;">Uploaded</span>'
      : '<span style="color:#dc2626;font-weight:600;">Not provided</span>');
    if (cardData.logo) {
      logoRow += '<br><img src="' + esc(cardData.logo) + '" alt="Logo" style="max-height:48px;' +
        'margin-top:8px;border:1px solid #e5e7eb;border-radius:4px;padding:4px;background:#fff;">';
    }

    return infoTable([
      ['Primary Color', colorSwatch(primary)],
      ['Accent Color', colorSwatch(accent)],
      ['Card Style', esc(cardData.cardStyle || 'Not selected')],
      ['Fonts', 'Poppins + Inter (Standard)'],
      ['Logo', logoRow],
    ]);
  }

  /**
   * Section 6 - Automation / Integration Notes.
   */
  function renderAutomationNotes(cardData) {
    var notes = [];

    if (hasFeature(cardData, 'booking')) {
      notes.push('Connect GHL calendar for online booking');
    }
    if (hasFeature(cardData, 'lead-capture') || hasFeature(cardData, 'leadCapture')) {
      notes.push('Set up GHL form/funnel for lead capture');
    }
    if (hasFeature(cardData, 'reviews')) {
      notes.push('Connect Google Business for review automation');
    }
    if (cardData.mediaType === 'video' && cardData.videoUrl) {
      notes.push('Verify video embed URL is public/unlisted');
    }
    notes.push('Set up contact form notification workflow');

    var html = '<ul style="margin:12px 0 20px;padding-left:24px;">';
    for (var i = 0; i < notes.length; i++) {
      html += '<li style="padding:6px 0;font-size:14px;color:#374151;">' +
        esc(notes[i]) + '</li>';
    }
    html += '</ul>';
    return html;
  }

  /**
   * Section 7 - Build Status Summary.
   */
  function renderBuildStatus(cardData) {
    var result = (typeof Utils !== 'undefined' && Utils.calculateCompleteness)
      ? Utils.calculateCompleteness(cardData)
      : { score: 0, missing: ['Unable to calculate'] };

    var score = result.score;
    var missing = result.missing;

    var readiness;
    var readinessColor;
    if (score > 80) {
      readiness = 'Ready to Build';
      readinessColor = '#059669';
    } else if (score >= 50) {
      readiness = 'Needs More Info';
      readinessColor = '#d97706';
    } else {
      readiness = 'Early Draft';
      readinessColor = '#dc2626';
    }

    var barColor = score > 80 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444';

    var html = '<div style="margin:12px 0 20px;">';

    // Completeness percentage
    html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">' +
      '<span style="font-size:32px;font-weight:700;color:' + barColor + ';">' + score + '%</span>' +
      '<span style="font-size:14px;color:#6b7280;">Complete</span>' +
      '</div>';

    // Progress bar
    html += '<div style="width:100%;height:12px;background:#e5e7eb;border-radius:6px;overflow:hidden;margin-bottom:16px;">' +
      '<div style="width:' + Math.min(score, 100) + '%;height:100%;background:' + barColor +
      ';border-radius:6px;transition:width 0.3s;"></div></div>';

    // Readiness level
    html += '<p style="font-size:15px;font-weight:600;color:' + readinessColor + ';margin:0 0 12px;">' +
      'Estimated Readiness: ' + readiness + '</p>';

    // Missing items
    if (missing.length > 0) {
      html += '<p style="font-size:13px;font-weight:600;color:#374151;margin:0 0 6px;">Items to collect:</p>';
      html += '<ul style="margin:0 0 0 20px;padding:0;">';
      for (var i = 0; i < missing.length; i++) {
        html += '<li style="padding:3px 0;font-size:13px;color:#6b7280;">' + esc(missing[i]) + '</li>';
      }
      html += '</ul>';
    }

    html += '</div>';
    return html;
  }

  /**
   * Section 8 - Internal Notes.
   */
  function renderInternalNotes(cardData) {
    var notes = cardData.internalNotes;
    if (!notes || String(notes).trim() === '') {
      return '<p style="color:#9ca3af;font-style:italic;font-size:14px;margin:12px 0;">No internal notes</p>';
    }
    return '<div style="margin:12px 0 20px;padding:16px;background:#fefce8;border:1px solid #fde68a;' +
      'border-radius:8px;font-size:14px;color:#92400e;white-space:pre-wrap;line-height:1.6;">' +
      esc(notes) + '</div>';
  }

  // ─── 3. EXPORT PDF ────────────────────────────────────────────────────────

  /**
   * Load jsPDF from CDN if not already available.
   */
  function loadJsPDF() {
    return new Promise(function (resolve, reject) {
      if (window.jspdf && window.jspdf.jsPDF) {
        resolve(window.jspdf.jsPDF);
        return;
      }
      var script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      script.onload = function () {
        if (window.jspdf && window.jspdf.jsPDF) {
          resolve(window.jspdf.jsPDF);
        } else {
          reject(new Error('jsPDF failed to initialize'));
        }
      };
      script.onerror = function () {
        reject(new Error('Failed to load jsPDF from CDN'));
      };
      document.head.appendChild(script);
    });
  }

  /**
   * Export the build sheet as a formatted PDF. Triggers browser download.
   */
  BuildSheet.exportPDF = async function (cardData) {
    try {
      if (typeof Utils !== 'undefined' && Utils.showToast) {
        Utils.showToast('Generating PDF...', 'info');
      }

      var JPDF = await loadJsPDF();
      var doc = new JPDF({ unit: 'mm', format: 'a4' });

      var pageW = 210;
      var margin = 18;
      var contentW = pageW - margin * 2;
      var pageH = 297;
      var y = 0;
      var pageNum = 1;

      var businessName = cardData.businessName || 'Untitled';

      function addHeader() {
        doc.setFillColor(30, 41, 59); // #1e293b
        doc.rect(0, 0, pageW, 14, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(8);
        doc.text('vNetCard\u2122 VE Build Sheet', margin, 9);
        doc.text('Page ' + pageNum, pageW - margin, 9, { align: 'right' });
        doc.setTextColor(0, 0, 0);
      }

      function addFooter() {
        doc.setFontSize(7);
        doc.setTextColor(148, 163, 184);
        doc.text(
          'Generated ' + new Date().toLocaleDateString() + ' | vNetCard\u2122 Studio',
          pageW / 2, pageH - 8, { align: 'center' }
        );
        doc.setTextColor(0, 0, 0);
      }

      function checkPage(needed) {
        if (y + needed > pageH - 20) {
          addFooter();
          doc.addPage();
          pageNum++;
          addHeader();
          y = 22;
        }
      }

      function addSectionTitle(title) {
        checkPage(16);
        doc.setFontSize(13);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(30, 41, 59);
        doc.text(title, margin, y);
        y += 2;
        doc.setDrawColor(30, 41, 59);
        doc.setLineWidth(0.5);
        doc.line(margin, y, pageW - margin, y);
        y += 6;
        doc.setFont(undefined, 'normal');
        doc.setTextColor(0, 0, 0);
      }

      function addKeyValue(key, val) {
        checkPage(8);
        doc.setFontSize(9);
        doc.setFont(undefined, 'bold');
        doc.text(key + ':', margin, y);
        doc.setFont(undefined, 'normal');
        var valText = String(val || 'N/A');
        var lines = doc.splitTextToSize(valText, contentW - 45);
        doc.text(lines, margin + 45, y);
        y += Math.max(lines.length * 4.5, 6);
      }

      function addText(text, opts) {
        opts = opts || {};
        var size = opts.size || 9;
        doc.setFontSize(size);
        if (opts.bold) doc.setFont(undefined, 'bold');
        var lines = doc.splitTextToSize(String(text), contentW);
        checkPage(lines.length * (size * 0.45) + 4);
        doc.text(lines, margin, y);
        y += lines.length * (size * 0.45) + 3;
        if (opts.bold) doc.setFont(undefined, 'normal');
      }

      function addBullet(text) {
        checkPage(7);
        doc.setFontSize(9);
        var lines = doc.splitTextToSize(String(text), contentW - 8);
        doc.text('\u2022', margin + 2, y);
        doc.text(lines, margin + 8, y);
        y += lines.length * 4.5 + 1;
      }

      // ── TITLE PAGE ──
      addHeader();
      y = 80;
      doc.setFontSize(11);
      doc.setTextColor(100, 116, 139);
      doc.text('vNetCard\u2122 VE Build Sheet', pageW / 2, y, { align: 'center' });
      y += 14;
      doc.setFontSize(26);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(15, 23, 42);
      var titleLines = doc.splitTextToSize(businessName, contentW);
      doc.text(titleLines, pageW / 2, y, { align: 'center' });
      y += titleLines.length * 10 + 10;
      doc.setFontSize(12);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text(formatDate(new Date().toISOString()), pageW / 2, y, { align: 'center' });
      y += 8;
      doc.text('Status: ' + (cardData.status || 'draft'), pageW / 2, y, { align: 'center' });
      addFooter();

      // ── CONTENT PAGES ──
      doc.addPage();
      pageNum++;
      addHeader();
      y = 22;

      // Section 1: Client Overview
      addSectionTitle('1. Client Overview');
      addKeyValue('Business Name', cardData.businessName);
      addKeyValue('Contact Name', cardData.contactName);
      addKeyValue('Title', cardData.contactTitle);
      addKeyValue('Phone', cardData.phone);
      addKeyValue('Email', cardData.email);
      addKeyValue('Website', cardData.website);
      addKeyValue('Industry', cardData.industry);
      addKeyValue('Service Area', cardData.serviceArea);
      y += 4;

      // Section 2: Card Section Specs
      addSectionTitle('2. Card Section Specs');
      addKeyValue('Hero', 'Colors: ' + (cardData.primaryColor || 'N/A') + ' / ' + (cardData.accentColor || 'N/A'));
      addKeyValue('Contact Actions', 'Call: ' + (cardData.callLabel || 'Call') + ' | Text: ' + (cardData.textLabel || 'Text') + ' | Email: ' + (cardData.emailLabel || 'Email'));
      addKeyValue('Utility Buttons', 'Standard - No customization needed');
      addKeyValue('Welcome Audio', cardData.welcomeAudioEnabled ? (cardData.welcomeAudioScript || 'Script not provided') : 'Disabled');
      addKeyValue('Media Type', cardData.mediaType || 'Not selected');
      if (cardData.mediaType === 'video') {
        addKeyValue('Video URL', cardData.videoUrl || 'Not provided');
      }
      var tabs = getCustomTabs(cardData);
      addKeyValue('Custom Tabs', tabs.length > 0 ? tabs.map(function (t) { return t.name || t.label || 'Unnamed'; }).join(', ') : 'None');
      var platforms = getSocialPlatforms(cardData);
      addKeyValue('Social Media', platforms.length > 0 ? platforms.join(', ') : 'None');
      addKeyValue('Footer Tagline', cardData.footerTagline);
      addKeyValue('Powered By', 'Standard');
      y += 4;

      // Section 3: Asset Checklist
      addSectionTitle('3. Asset Collection Checklist');
      var assets = [
        ['Logo file', cardData.logo],
        ['Profile photo', cardData.profilePhoto],
        ['Hero / background image', cardData.heroImage],
        ['Gallery photos', cardData.gallery && cardData.gallery.length > 0],
        ['Video URL', cardData.mediaType === 'video' ? cardData.videoUrl : null],
        ['Social media links', platforms.length > 0],
        ['Testimonials / reviews', cardData.reviews && cardData.reviews.length > 0],
        ['Services list', cardData.services && cardData.services.length > 0],
        ['FAQ content', cardData.faqs && cardData.faqs.length > 0],
        ['Team member info', cardData.team && cardData.team.length > 0],
      ];
      for (var ai = 0; ai < assets.length; ai++) {
        if (assets[ai][1] === null) continue;
        var mark = assets[ai][1] ? '\u2705' : '\u26A0\uFE0F';
        var statusLabel = assets[ai][1] ? 'Confirmed' : 'Missing';
        addBullet(assets[ai][0] + ' - ' + statusLabel);
      }
      y += 4;

      // Section 4: Custom Tabs Spec
      if (tabs.length > 0) {
        addSectionTitle('4. Custom Tabs Spec');
        for (var ti = 0; ti < tabs.length; ti++) {
          var tab = tabs[ti];
          addKeyValue(tab.name || tab.label || 'Tab ' + (ti + 1),
            'Type: ' + (tab.type || 'custom') +
            ' | CTA: ' + (tab.ctaText || tab.ctaLabel || 'N/A') +
            ' | Link: ' + (tab.link || tab.action || tab.url || 'Needs setup'));
        }
        y += 4;
      }

      // Section 5: Branding Spec
      addSectionTitle('5. Branding Spec');
      addKeyValue('Primary Color', cardData.primaryColor || 'Not set');
      addKeyValue('Accent Color', cardData.accentColor || 'Not set');
      addKeyValue('Card Style', cardData.cardStyle || 'Not selected');
      addKeyValue('Fonts', 'Poppins + Inter (Standard)');
      addKeyValue('Logo', cardData.logo ? 'Uploaded' : 'Not provided');
      y += 4;

      // Section 6: Automation Notes
      addSectionTitle('6. Automation / Integration Notes');
      var autoNotes = [];
      if (hasFeature(cardData, 'booking')) autoNotes.push('Connect GHL calendar for online booking');
      if (hasFeature(cardData, 'lead-capture') || hasFeature(cardData, 'leadCapture')) autoNotes.push('Set up GHL form/funnel for lead capture');
      if (hasFeature(cardData, 'reviews')) autoNotes.push('Connect Google Business for review automation');
      if (cardData.mediaType === 'video' && cardData.videoUrl) autoNotes.push('Verify video embed URL is public/unlisted');
      autoNotes.push('Set up contact form notification workflow');
      for (var ni = 0; ni < autoNotes.length; ni++) {
        addBullet(autoNotes[ni]);
      }
      y += 4;

      // Section 7: Build Status
      var result = (typeof Utils !== 'undefined' && Utils.calculateCompleteness)
        ? Utils.calculateCompleteness(cardData)
        : { score: 0, missing: ['Unable to calculate'] };
      addSectionTitle('7. Build Status Summary');
      addKeyValue('Completeness', result.score + '%');
      var readinessLabel = result.score > 80 ? 'Ready to Build' : result.score >= 50 ? 'Needs More Info' : 'Early Draft';
      addKeyValue('Readiness', readinessLabel);
      if (result.missing.length > 0) {
        addText('Missing items:', { bold: true });
        for (var mi = 0; mi < result.missing.length; mi++) {
          addBullet(result.missing[mi]);
        }
      }
      y += 4;

      // Section 8: Internal Notes
      addSectionTitle('8. Internal Notes');
      var intNotes = cardData.internalNotes && String(cardData.internalNotes).trim() !== ''
        ? cardData.internalNotes
        : 'No internal notes';
      addText(intNotes);

      addFooter();

      // Trigger download
      var slug = (typeof Utils !== 'undefined' && Utils.slugify)
        ? Utils.slugify(businessName)
        : businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      doc.save(slug + '-build-sheet.pdf');

      if (typeof Utils !== 'undefined' && Utils.showToast) {
        Utils.showToast('PDF exported successfully', 'success');
      }
    } catch (err) {
      console.error('[BuildSheet] PDF export error:', err);
      if (typeof Utils !== 'undefined' && Utils.showToast) {
        Utils.showToast('PDF export failed: ' + err.message, 'error');
      }
    }
  };

  // ─── 4. COPY AS TEXT ──────────────────────────────────────────────────────

  /**
   * Format all build sheet data as plain text and copy to clipboard.
   */
  BuildSheet.copyAsText = function (cardData) {
    var sep = '────────────────────────────────────────';
    var lines = [];

    lines.push('vNetCard\u2122 VE Build Sheet');
    lines.push(sep);
    lines.push('Business: ' + (cardData.businessName || 'Untitled'));
    lines.push('Generated: ' + formatDate(new Date().toISOString()));
    lines.push('Status: ' + (cardData.status || 'draft'));
    lines.push('');

    // Section 1
    lines.push('1. CLIENT OVERVIEW');
    lines.push(sep);
    lines.push('Business Name:  ' + (cardData.businessName || 'N/A'));
    lines.push('Contact Name:   ' + (cardData.contactName || 'N/A'));
    lines.push('Title:          ' + (cardData.contactTitle || 'N/A'));
    lines.push('Phone:          ' + (cardData.phone || 'N/A'));
    lines.push('Email:          ' + (cardData.email || 'N/A'));
    lines.push('Website:        ' + (cardData.website || 'N/A'));
    lines.push('Industry:       ' + (cardData.industry || 'N/A'));
    lines.push('Service Area:   ' + (cardData.serviceArea || 'N/A'));
    lines.push('');

    // Section 2
    lines.push('2. CARD SECTION SPECS');
    lines.push(sep);
    lines.push('Hero:             Colors: ' + (cardData.primaryColor || 'N/A') + ' / ' + (cardData.accentColor || 'N/A'));
    lines.push('Contact Actions:  Call: ' + (cardData.callLabel || 'Call') + ' | Text: ' + (cardData.textLabel || 'Text') + ' | Email: ' + (cardData.emailLabel || 'Email'));
    lines.push('Utility Buttons:  Standard - No customization needed');
    lines.push('Welcome Audio:    ' + (cardData.welcomeAudioEnabled ? (cardData.welcomeAudioScript || 'Script not provided') : 'Disabled'));
    lines.push('Media:            Type: ' + (cardData.mediaType || 'Not selected'));
    if (cardData.mediaType === 'video') {
      lines.push('                  Video URL: ' + (cardData.videoUrl || 'Not provided'));
    }
    var tabs = getCustomTabs(cardData);
    lines.push('Custom Tabs:      ' + (tabs.length > 0 ? tabs.map(function (t) { return t.name || t.label || 'Unnamed'; }).join(', ') : 'None'));
    var platforms = getSocialPlatforms(cardData);
    lines.push('Social Media:     ' + (platforms.length > 0 ? platforms.join(', ') : 'None'));
    lines.push('Footer:           ' + (cardData.footerTagline || 'N/A'));
    lines.push('Powered By:       Standard');
    lines.push('');

    // Section 3
    lines.push('3. ASSET COLLECTION CHECKLIST');
    lines.push(sep);
    var assets = [
      ['Logo file', cardData.logo],
      ['Profile photo', cardData.profilePhoto],
      ['Hero / background image', cardData.heroImage],
      ['Gallery photos', cardData.gallery && cardData.gallery.length > 0],
      ['Video URL', cardData.mediaType === 'video' ? cardData.videoUrl : null],
      ['Social media links', platforms.length > 0],
      ['Testimonials / reviews', cardData.reviews && cardData.reviews.length > 0],
      ['Services list', cardData.services && cardData.services.length > 0],
      ['FAQ content', cardData.faqs && cardData.faqs.length > 0],
      ['Team member info', cardData.team && cardData.team.length > 0],
    ];
    for (var i = 0; i < assets.length; i++) {
      if (assets[i][1] === null) continue;
      var mark = assets[i][1] ? '[OK]' : '[!!]';
      var label = assets[i][1] ? 'Confirmed' : 'Missing';
      lines.push('  ' + mark + ' ' + assets[i][0] + ' - ' + label);
    }
    lines.push('');

    // Section 4
    if (tabs.length > 0) {
      lines.push('4. CUSTOM TABS SPEC');
      lines.push(sep);
      for (var t = 0; t < tabs.length; t++) {
        var tab = tabs[t];
        lines.push('  ' + (tab.name || tab.label || 'Tab ' + (t + 1)) +
          ' | Type: ' + (tab.type || 'custom') +
          ' | CTA: ' + (tab.ctaText || tab.ctaLabel || 'N/A') +
          ' | Link: ' + (tab.link || tab.action || tab.url || 'Needs setup'));
      }
      lines.push('');
    }

    // Section 5
    lines.push('5. BRANDING SPEC');
    lines.push(sep);
    lines.push('Primary Color:  ' + (cardData.primaryColor || 'Not set'));
    lines.push('Accent Color:   ' + (cardData.accentColor || 'Not set'));
    lines.push('Card Style:     ' + (cardData.cardStyle || 'Not selected'));
    lines.push('Fonts:          Poppins + Inter (Standard)');
    lines.push('Logo:           ' + (cardData.logo ? 'Uploaded' : 'Not provided'));
    lines.push('');

    // Section 6
    lines.push('6. AUTOMATION / INTEGRATION NOTES');
    lines.push(sep);
    if (hasFeature(cardData, 'booking')) lines.push('  - Connect GHL calendar for online booking');
    if (hasFeature(cardData, 'lead-capture') || hasFeature(cardData, 'leadCapture')) lines.push('  - Set up GHL form/funnel for lead capture');
    if (hasFeature(cardData, 'reviews')) lines.push('  - Connect Google Business for review automation');
    if (cardData.mediaType === 'video' && cardData.videoUrl) lines.push('  - Verify video embed URL is public/unlisted');
    lines.push('  - Set up contact form notification workflow');
    lines.push('');

    // Section 7
    var result = (typeof Utils !== 'undefined' && Utils.calculateCompleteness)
      ? Utils.calculateCompleteness(cardData)
      : { score: 0, missing: ['Unable to calculate'] };
    lines.push('7. BUILD STATUS SUMMARY');
    lines.push(sep);
    lines.push('Completeness:  ' + result.score + '%');
    var readinessLabel = result.score > 80 ? 'Ready to Build' : result.score >= 50 ? 'Needs More Info' : 'Early Draft';
    lines.push('Readiness:     ' + readinessLabel);
    if (result.missing.length > 0) {
      lines.push('Missing items:');
      for (var m = 0; m < result.missing.length; m++) {
        lines.push('  - ' + result.missing[m]);
      }
    }
    lines.push('');

    // Section 8
    lines.push('8. INTERNAL NOTES');
    lines.push(sep);
    lines.push(cardData.internalNotes && String(cardData.internalNotes).trim() !== ''
      ? cardData.internalNotes
      : 'No internal notes');

    var text = lines.join('\n');

    if (typeof Utils !== 'undefined' && Utils.copyToClipboard) {
      Utils.copyToClipboard(text);
    } else {
      navigator.clipboard.writeText(text).catch(function (err) {
        console.error('[BuildSheet] Clipboard copy failed:', err);
      });
    }
  };

  // ─── 5. PRINT ─────────────────────────────────────────────────────────────

  /**
   * Open the browser print dialog with print-optimized styles.
   */
  BuildSheet.print = function () {
    var styleId = 'buildsheet-print-styles';
    if (!document.getElementById(styleId)) {
      var style = document.createElement('style');
      style.id = styleId;
      style.textContent =
        '@media print {' +
        '  body > *:not([data-view="buildsheet"]) { display: none !important; }' +
        '  [data-view="buildsheet"] { display: block !important; position: static !important; }' +
        '  nav, .sidebar, header, footer, .toast-container, ' +
        '  #buildsheet-export-pdf, #buildsheet-copy-text, #buildsheet-print ' +
        '    { display: none !important; }' +
        '  table { page-break-inside: avoid; }' +
        '  h3 { page-break-after: avoid; }' +
        '  @page { margin: 15mm; }' +
        '}';
      document.head.appendChild(style);
    }
    window.print();
  };

  // ─── EXPOSE GLOBAL ────────────────────────────────────────────────────────

  window.BuildSheet = BuildSheet;
})();
