/**
 * vNetCard Studio - Card Rendering Engine
 * Core generator that produces self-contained HTML for vNetCard digital
 * business card previews. All output is a single standalone HTML document
 * with inlined CSS and JS -- zero external dependencies beyond Google Fonts.
 *
 * Exposed on window.Generator with three public methods:
 *   Generator.generateCardHTML(cardData)   - returns HTML string
 *   Generator.exportCardHTML(cardData)      - triggers browser download
 *   Generator.renderCardPreview(cardData, targetIframe) - writes to iframe
 *
 * (c) vNetCard - All rights reserved.
 */

(function () {
  'use strict';

  var Generator = {};

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  function esc(str) {
    if (!str) return '';
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(String(str)));
    return d.innerHTML;
  }

  function slugify(text) {
    if (window.Utils && window.Utils.slugify) return window.Utils.slugify(text);
    if (!text) return '';
    return String(text).toLowerCase().trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/--+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function initials(name) {
    if (!name) return '';
    var parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  function resolveIndustryDefaults(industry) {
    if (window.Utils && window.Utils.getIndustryDefaults) {
      return window.Utils.getIndustryDefaults(industry);
    }
    return {
      tagline: 'Your Trusted Local Professional',
      trustPills: ['Licensed & Insured', 'Free Estimates'],
      serviceCategories: ['General Services'],
    };
  }

  function phoneDigits(phone) {
    return (phone || '').replace(/\D/g, '');
  }

  // Brand logo helper - renders the stylized vNetCard(tm) logo
  function vnetcardLogo(size) {
    var fs = size === 'large' ? '28px' : size === 'medium' ? '18px' : '13px';
    return '<span style="font-family:Poppins,sans-serif;font-size:' + fs + ';font-weight:700;letter-spacing:-0.5px;">'
      + '<span style="color:#22C55E;">v</span>'
      + '<span style="color:#FFFFFF;">Net</span>'
      + '<span style="color:#C5A028;">Card</span>'
      + '<span style="font-size:60%;vertical-align:super;color:#C5A028;">\u2122</span>'
      + '</span>';
  }

  // Extract Instagram username from URL
  function extractInstaUsername(url) {
    if (!url) return '';
    var m = url.match(/instagram\.com\/([^/?#]+)/);
    return m ? '@' + m[1] : '@' + url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }

  // ---------------------------------------------------------------------------
  // SECTION BUILDERS
  // ---------------------------------------------------------------------------

  // SECTION 1: Powered By Header Bar
  function buildPoweredByHeader() {
    return '<div style="background:#1A2C5B;padding:8px 16px;display:flex;align-items:center;justify-content:space-between;">'
      + '<div style="display:flex;align-items:center;gap:6px;">'
      + '<span style="font-size:10px;color:rgba(255,255,255,0.6);font-family:Inter,sans-serif;">Powered by</span>'
      + vnetcardLogo('small')
      + '</div>'
      + '<span style="font-size:9px;color:rgba(255,255,255,0.5);font-family:Inter,sans-serif;font-style:italic;">Connect Digitally</span>'
      + '</div>';
  }

  // SECTION 2: Hero / Banner
  function buildHeroBanner(d) {
    var profileHTML = '';
    if (d.profilePhotoUrl || d.profilePhoto) {
      var src = d.profilePhotoUrl || d.profilePhoto;
      profileHTML = '<img src="' + esc(src) + '" alt="' + esc(d.contactName || d.businessName) + '" style="'
        + 'width:160px;height:200px;object-fit:cover;object-position:top center;'
        + 'border-radius:12px 12px 0 0;filter:drop-shadow(0 4px 12px rgba(0,0,0,0.3));'
        + '">';
    } else {
      // Professional placeholder silhouette
      profileHTML = '<div style="width:160px;height:200px;border-radius:12px 12px 0 0;background:rgba(26,44,91,0.2);display:flex;align-items:center;justify-content:center;">'
        + '<svg width="80" height="100" viewBox="0 0 80 100" fill="none">'
        + '<circle cx="40" cy="28" r="20" fill="rgba(26,44,91,0.3)"/>'
        + '<ellipse cx="40" cy="85" rx="32" ry="25" fill="rgba(26,44,91,0.3)"/>'
        + '</svg>'
        + '</div>';
    }

    return '<div style="background:linear-gradient(135deg,#C5A028 0%,#E8D44D 50%,#C5A028 100%);padding:28px 20px 0;display:flex;align-items:flex-end;gap:12px;position:relative;overflow:hidden;">'
      + '<div style="flex:1;padding-bottom:28px;">'
      + '<p style="font-family:Poppins,sans-serif;font-size:22px;font-weight:800;font-style:italic;color:#1A2C5B;line-height:1.2;margin-bottom:10px;">'
      + 'Don\'t Waste A<br>First Impression!</p>'
      + '<p style="font-family:Inter,sans-serif;font-size:12px;font-weight:500;color:#1A2C5B;line-height:1.4;">'
      + 'Turn Your Business Networking<br>Into Meaningful Interactions!</p>'
      + '</div>'
      + '<div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;">'
      + profileHTML
      + '</div>'
      + '</div>';
  }

  // SECTION 3: Name / Contact Info Card
  function buildNameCard(d) {
    var name = d.contactName || d.businessName || 'Your Name';
    var title = d.title || d.contactTitle || '';
    var specialty = d.specialty || d.tagline || '';
    var phone = d.phone || '';
    var email = d.email || '';

    return '<div style="background:#1A2C5B;padding:32px 24px 36px;position:relative;text-align:center;">'
      + '<h1 style="font-family:Poppins,sans-serif;font-size:32px;font-weight:700;color:#FFFFFF;margin:0 0 8px;line-height:1.15;">'
      + esc(name) + '</h1>'
      + (title ? '<p style="font-family:Inter,sans-serif;font-size:16px;color:#C5A028;font-weight:600;margin:0 0 4px;">' + esc(title) + '</p>' : '')
      + (specialty && specialty !== title ? '<p style="font-family:Inter,sans-serif;font-size:14px;color:#E8D44D;font-weight:500;margin:0 0 12px;">' + esc(specialty) + '</p>' : '<div style="margin-bottom:12px;"></div>')
      + (phone ? '<p style="font-family:Inter,sans-serif;font-size:15px;color:#FFFFFF;margin:0 0 4px;">' + esc(phone) + '</p>' : '')
      + (email ? '<p style="font-family:Inter,sans-serif;font-size:15px;color:#FFFFFF;margin:0;">' + esc(email) + '</p>' : '')
      + '</div>';
  }

  // SECTION 4: Contact Action Buttons
  function buildContactActions(d) {
    var phone = phoneDigits(d.phone);
    var email = d.email || '';

    var callSVG = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>';
    var textSVG = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>';
    var emailSVG = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>';

    var btnStyle = 'flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;text-decoration:none;';
    var iconStyle = 'width:48px;height:48px;border-radius:50%;background:#22C55E;display:flex;align-items:center;justify-content:center;';
    var labelStyle = 'font-family:Inter,sans-serif;font-size:13px;font-weight:700;color:#1A2C5B;';

    var btns = '';
    btns += '<a href="tel:' + esc(phone) + '" style="' + btnStyle + '">'
      + '<div style="' + iconStyle + '">' + callSVG + '</div>'
      + '<span style="' + labelStyle + '">Call</span></a>';

    btns += '<a href="sms:' + esc(phone) + '" style="' + btnStyle + '">'
      + '<div style="' + iconStyle + '">' + textSVG + '</div>'
      + '<span style="' + labelStyle + '">Text</span></a>';

    btns += '<a href="mailto:' + esc(email) + '" style="' + btnStyle + '">'
      + '<div style="' + iconStyle + '">' + emailSVG + '</div>'
      + '<span style="' + labelStyle + '">Email</span></a>';

    if (d.quickActionEnabled && d.quickActionLabel) {
      var qaSVG = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
      btns += '<a href="' + esc(d.quickActionUrl || '#') + '" style="' + btnStyle + '">'
        + '<div style="' + iconStyle + '">' + qaSVG + '</div>'
        + '<span style="' + labelStyle + '">' + esc(d.quickActionLabel) + '</span></a>';
    }

    return '<div style="background:#FFFFFF;padding:24px 20px;">'
      + '<div style="display:flex;gap:8px;justify-content:center;">' + btns + '</div>'
      + '</div>';
  }

  // SECTION 5: Utility Buttons (2x2 Grid)
  function buildUtilityButtons() {
    var btnStyle = 'flex:1;padding:14px 8px;border:2px solid #D1D5DB;border-radius:10px;background:#FFFFFF;'
      + 'font-family:Inter,sans-serif;font-size:13px;font-weight:600;color:#1A2C5B;text-align:center;cursor:pointer;'
      + 'transition:background 0.2s,border-color 0.2s;';

    return '<div style="background:#F9FAFB;padding:12px 20px 20px;">'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'
      + '<button style="' + btnStyle + '">Scan QR Code</button>'
      + '<button style="' + btnStyle + '">Save My Contact</button>'
      + '<button style="' + btnStyle + '">Exchange Info</button>'
      + '<button style="' + btnStyle + '">Refer A Friend</button>'
      + '</div>'
      + '</div>';
  }

  // SECTION 6: Audio Player
  function buildAudioPlayer(d) {
    var hasAudio = d.welcomeAudioEnabled && d.welcomeAudioScript;
    var scriptHTML = '';
    if (hasAudio) {
      scriptHTML = '<p style="font-family:Inter,sans-serif;font-size:14px;color:#555;font-style:italic;line-height:1.6;margin:0 0 14px;padding:0 4px;">'
        + '&ldquo;' + esc(d.welcomeAudioScript) + '&rdquo;</p>';
    }

    var audioSrc = d.welcomeAudioUrl || '';

    return '<div style="background:#FFFFFF;padding:20px 20px 24px;">'
      + '<h3 style="font-family:Poppins,sans-serif;font-size:16px;font-weight:600;color:#1A2C5B;margin:0 0 12px;">Welcome Message</h3>'
      + scriptHTML
      + '<audio controls style="width:100%;height:40px;border-radius:8px;"'
      + (audioSrc ? ' src="' + esc(audioSrc) + '"' : '') + '>'
      + 'Your browser does not support the audio element.'
      + '</audio>'
      + '</div>';
  }

  // SECTION 7: Social Media Embed (Instagram focus)
  function buildSocialEmbed(d) {
    var social = d.socialLinks || {};
    var bizName = d.businessName || 'Our Business';
    var instaUrl = social.instagram || '';

    if (instaUrl) {
      var username = extractInstaUsername(instaUrl);
      var avatarHTML = '';
      if (d.logoUrl || d.logo) {
        avatarHTML = '<img src="' + esc(d.logoUrl || d.logo) + '" style="width:48px;height:48px;border-radius:50%;object-fit:cover;" alt="Logo">';
      } else {
        var init = initials(bizName);
        avatarHTML = '<div style="width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#833ab4,#fd1d1d,#fcb045);display:flex;align-items:center;justify-content:center;font-family:Poppins,sans-serif;font-size:18px;font-weight:700;color:#fff;">'
          + esc(init) + '</div>';
      }

      return '<div style="background:#F9FAFB;padding:20px;">'
        + '<h3 style="font-family:Poppins,sans-serif;font-size:16px;font-weight:600;color:#1A2C5B;margin:0 0 14px;text-align:center;">'
        + 'Follow ' + esc(bizName) + ' on InstaGram</h3>'
        + '<div style="background:#fff;border:1px solid #DBDBDB;border-radius:12px;overflow:hidden;">'
        // Profile header
        + '<div style="padding:16px;display:flex;align-items:center;gap:12px;">'
        + avatarHTML
        + '<div style="flex:1;">'
        + '<p style="font-family:Inter,sans-serif;font-size:14px;font-weight:700;color:#262626;margin:0;">' + esc(username) + '</p>'
        + '<div style="display:flex;gap:16px;margin-top:4px;">'
        + '<span style="font-size:11px;color:#8E8E8E;font-family:Inter,sans-serif;"><strong style="color:#262626;">--</strong> posts</span>'
        + '<span style="font-size:11px;color:#8E8E8E;font-family:Inter,sans-serif;"><strong style="color:#262626;">--</strong> followers</span>'
        + '<span style="font-size:11px;color:#8E8E8E;font-family:Inter,sans-serif;"><strong style="color:#262626;">--</strong> following</span>'
        + '</div>'
        + '</div>'
        + '<a href="' + esc(instaUrl) + '" target="_blank" style="padding:7px 20px;border-radius:8px;background:#0095F6;color:#fff;font-family:Inter,sans-serif;font-size:13px;font-weight:600;text-decoration:none;white-space:nowrap;">Follow</a>'
        + '</div>'
        // Dark preview grid
        + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:2px;">'
        + '<div style="aspect-ratio:1;background:#1A1A2E;"></div>'
        + '<div style="aspect-ratio:1;background:#252540;"></div>'
        + '<div style="aspect-ratio:1;background:#1A1A2E;"></div>'
        + '<div style="aspect-ratio:1;background:#252540;"></div>'
        + '<div style="aspect-ratio:1;background:#1A1A2E;"></div>'
        + '<div style="aspect-ratio:1;background:#252540;"></div>'
        + '</div>'
        + '</div>'
        + '</div>';
    }

    // No Instagram - generic placeholder
    return '<div style="background:#F9FAFB;padding:20px;text-align:center;">'
      + '<h3 style="font-family:Poppins,sans-serif;font-size:16px;font-weight:600;color:#1A2C5B;margin:0 0 10px;">Connect With Us On Social Media</h3>'
      + '<p style="font-family:Inter,sans-serif;font-size:13px;color:#888;margin:0;">Social media profiles coming soon.</p>'
      + '</div>';
  }

  // SECTION 8: Accordion Sections
  function buildAccordion(d) {
    var bizName = d.businessName || 'Our Business';
    var social = d.socialLinks || {};
    var items = [];

    // Helper to check features array
    function hasFeature(feat) {
      if (!d.features || !Array.isArray(d.features)) return false;
      return d.features.indexOf(feat) !== -1;
    }

    // --- Always-included items ---

    // Explainer Video
    var videoContent = '';
    if (d.videoUrl) {
      var ytMatch = d.videoUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([^&?#]+)/);
      if (ytMatch) {
        videoContent = '<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:8px;">'
          + '<iframe src="https://www.youtube.com/embed/' + esc(ytMatch[1]) + '" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;" allowfullscreen></iframe>'
          + '</div>';
      } else {
        videoContent = '<a href="' + esc(d.videoUrl) + '" target="_blank" style="display:block;padding:16px;background:#F0F2F5;border-radius:8px;text-align:center;text-decoration:none;color:#1A2C5B;font-family:Inter,sans-serif;font-weight:600;">Watch Video</a>';
      }
    } else {
      videoContent = '<p style="font-family:Inter,sans-serif;font-size:14px;color:#888;text-align:center;padding:20px 0;">Explainer video coming soon.</p>';
    }
    items.push({ label: esc(bizName) + ' Explainer Video', type: 'expand', content: videoContent });

    // What Is [Business Name]?
    var aboutContent = '';
    if (d.aboutText || d.services || d.serviceCategories) {
      aboutContent = '<div style="font-family:Inter,sans-serif;font-size:14px;color:#444;line-height:1.7;">';
      if (d.aboutText) {
        aboutContent += '<p style="margin:0 0 12px;">' + esc(d.aboutText) + '</p>';
      }
      if (d.serviceCategories && d.serviceCategories.length) {
        aboutContent += '<p style="font-weight:600;color:#1A2C5B;margin:0 0 8px;">Our Services:</p><ul style="margin:0;padding-left:20px;">';
        for (var si = 0; si < d.serviceCategories.length; si++) {
          aboutContent += '<li style="margin-bottom:4px;">' + esc(d.serviceCategories[si]) + '</li>';
        }
        aboutContent += '</ul>';
      }
      aboutContent += '</div>';
    } else {
      aboutContent = '<p style="font-family:Inter,sans-serif;font-size:14px;color:#555;line-height:1.7;">'
        + esc(bizName) + ' is dedicated to providing exceptional service and building lasting relationships with our clients.</p>';
    }
    items.push({ label: 'What Is ' + esc(bizName) + '?', type: 'expand', content: aboutContent });

    // A Better Way To Connect
    items.push({ label: 'A Better Way To Connect', type: 'expand', content:
      '<div style="font-family:Inter,sans-serif;font-size:14px;color:#444;line-height:1.7;">'
      + '<p style="margin:0 0 10px;">vNetCard\u2122 is a premium digital business card platform that transforms how professionals connect.</p>'
      + '<ul style="margin:0;padding-left:20px;">'
      + '<li style="margin-bottom:6px;">Share your contact info instantly with a tap or scan</li>'
      + '<li style="margin-bottom:6px;">Make a lasting first impression with a branded digital presence</li>'
      + '<li style="margin-bottom:6px;">Track engagement and follow up with ease</li>'
      + '<li style="margin-bottom:6px;">Eco-friendly - no more paper business cards</li>'
      + '</ul>'
      + '</div>'
    });

    // 10 Reasons To Get vNetCard
    items.push({ label: '10 Reasons To Get vNetCard\u2122', type: 'expand', content:
      '<div style="font-family:Inter,sans-serif;font-size:14px;color:#444;line-height:1.7;">'
      + '<ol style="margin:0;padding-left:20px;">'
      + '<li style="margin-bottom:6px;">Never run out of business cards again</li>'
      + '<li style="margin-bottom:6px;">Share your info with a single tap or QR scan</li>'
      + '<li style="margin-bottom:6px;">Make a powerful first impression every time</li>'
      + '<li style="margin-bottom:6px;">Update your info anytime without reprinting</li>'
      + '<li style="margin-bottom:6px;">Showcase your brand with videos, audio, and more</li>'
      + '<li style="margin-bottom:6px;">Track who views and engages with your card</li>'
      + '<li style="margin-bottom:6px;">Integrate with your CRM and follow-up tools</li>'
      + '<li style="margin-bottom:6px;">Go green and reduce paper waste</li>'
      + '<li style="margin-bottom:6px;">Stand out from the competition</li>'
      + '<li style="margin-bottom:6px;">Grow your network effortlessly</li>'
      + '</ol>'
      + '</div>'
    });

    // --- Additional items (always shown) ---

    // Get Started Now
    items.push({ label: 'Get Started Now', type: 'expand', content:
      '<div style="text-align:center;padding:8px 0;">'
      + '<a href="' + esc(d.bookingUrl || '#') + '" target="_blank" style="display:inline-block;padding:14px 32px;background:#22C55E;color:#fff;font-family:Poppins,sans-serif;font-size:15px;font-weight:600;border-radius:8px;text-decoration:none;">Book Now</a>'
      + '</div>'
    });

    // Visit Our Website (link-out)
    items.push({ label: 'Visit Our Website', type: 'link', url: d.website || '#' });

    // Got Questions? Contact Us
    items.push({ label: 'Got Questions? Contact Us', type: 'expand', content:
      '<div style="font-family:Inter,sans-serif;font-size:14px;color:#444;line-height:1.7;">'
      + '<p style="margin:0 0 12px;">We\'d love to hear from you! Reach out anytime:</p>'
      + (d.phone ? '<p style="margin:0 0 6px;"><strong>Phone:</strong> <a href="tel:' + esc(phoneDigits(d.phone)) + '" style="color:#1A2C5B;text-decoration:none;">' + esc(d.phone) + '</a></p>' : '')
      + (d.email ? '<p style="margin:0 0 6px;"><strong>Email:</strong> <a href="mailto:' + esc(d.email) + '" style="color:#1A2C5B;text-decoration:none;">' + esc(d.email) + '</a></p>' : '')
      + (d.website ? '<p style="margin:0;"><strong>Web:</strong> <a href="' + esc(d.website) + '" target="_blank" style="color:#1A2C5B;text-decoration:none;">' + esc(d.website.replace(/^https?:\/\//, '')) + '</a></p>' : '')
      + '</div>'
    });

    // Chat 24/7 With Our AI Assistant
    items.push({ label: 'Chat 24/7 With Our AI Assistant', type: 'expand', content:
      '<div style="text-align:center;padding:12px 0;">'
      + '<p style="font-family:Inter,sans-serif;font-size:14px;color:#555;margin:0 0 12px;">Get instant answers to your questions with our AI-powered assistant.</p>'
      + '<a href="' + esc(d.aiChatUrl || '#') + '" style="display:inline-block;padding:12px 28px;background:#1A2C5B;color:#fff;font-family:Poppins,sans-serif;font-size:14px;font-weight:600;border-radius:8px;text-decoration:none;">Start Chat</a>'
      + '</div>'
    });

    // Become A [Business Name] Affiliate
    items.push({ label: 'Become A vNetCard\u2122 Affiliate', type: 'expand', content:
      '<div style="font-family:Inter,sans-serif;font-size:14px;color:#444;line-height:1.7;">'
      + '<p style="margin:0 0 10px;">Join our affiliate program and earn while you share!</p>'
      + '<a href="' + esc(d.affiliateUrl || '#') + '" target="_blank" style="display:inline-block;padding:12px 28px;background:#C5A028;color:#fff;font-family:Poppins,sans-serif;font-size:14px;font-weight:600;border-radius:8px;text-decoration:none;">Learn More</a>'
      + '</div>'
    });

    // Book A Call (link-out)
    items.push({ label: 'Book A Call', type: 'link', url: d.bookingUrl || ('tel:' + phoneDigits(d.phone || '')) });

    // Business Growth Resources
    items.push({ label: 'Business Growth Resources', type: 'expand', content:
      '<div style="font-family:Inter,sans-serif;font-size:14px;color:#444;line-height:1.7;">'
      + '<p style="margin:0 0 10px;">Access our curated collection of business growth tools, tips, and strategies.</p>'
      + '<a href="' + esc(d.resourcesUrl || '#') + '" target="_blank" style="display:inline-block;padding:12px 28px;background:#1A2C5B;color:#fff;font-family:Poppins,sans-serif;font-size:14px;font-weight:600;border-radius:8px;text-decoration:none;">View Resources</a>'
      + '</div>'
    });

    // Read My Reviews
    var testimonials = d.testimonials && d.testimonials.length ? d.testimonials : null;
    var revHTML = '';
    if (testimonials) {
      revHTML = '<div style="display:flex;flex-direction:column;gap:12px;">';
      for (var ri = 0; ri < testimonials.length; ri++) {
        var t = testimonials[ri];
        var stars = '';
        for (var si2 = 0; si2 < (t.rating || 5); si2++) stars += '\u2B50';
        revHTML += '<div style="background:#F9FAFB;border-radius:8px;padding:14px;">'
          + '<div style="font-size:14px;margin-bottom:6px;">' + stars + '</div>'
          + '<p style="font-family:Inter,sans-serif;font-size:14px;color:#444;line-height:1.5;margin:0 0 8px;">&ldquo;' + esc(t.text) + '&rdquo;</p>'
          + '<p style="font-family:Inter,sans-serif;font-size:13px;color:#888;font-weight:500;margin:0;">&mdash; ' + esc(t.name) + '</p>'
          + '</div>';
      }
      revHTML += '</div>';
    } else {
      revHTML = '<p style="font-family:Inter,sans-serif;font-size:14px;color:#555;text-align:center;padding:12px 0;">Reviews coming soon.</p>';
    }
    items.push({ label: 'Read My Reviews', type: 'expand', content: revHTML });

    // Leave a Review
    items.push({ label: 'Leave A Review', type: 'expand', content:
      '<div style="text-align:center;padding:8px 0;">'
      + '<p style="font-family:Inter,sans-serif;font-size:14px;color:#555;margin:0 0 12px;">Your feedback helps us grow! We\'d love to hear about your experience.</p>'
      + '<a href="' + esc(d.reviewUrl || social.google || '#') + '" target="_blank" style="display:inline-block;padding:12px 28px;background:#C5A028;color:#fff;font-family:Poppins,sans-serif;font-size:14px;font-weight:600;border-radius:8px;text-decoration:none;">Leave A Review</a>'
      + '</div>'
    });

    // --- Build accordion HTML ---
    var html = '<div style="background:#FFFFFF;padding:16px 20px;" id="vc-accordion">';

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (item.type === 'link') {
        // Link-out button with orange arrow
        html += '<a href="' + esc(item.url) + '" target="_blank" style="display:flex;align-items:center;justify-content:space-between;'
          + 'background:#1A2C5B;border-radius:10px;padding:15px 18px;margin-bottom:10px;text-decoration:none;cursor:pointer;">'
          + '<span style="font-family:Inter,sans-serif;font-size:14px;font-weight:600;color:#FFFFFF;">' + item.label + '</span>'
          + '<span style="font-size:18px;color:#F47C20;font-weight:700;">\u2192</span>'
          + '</a>';
      } else {
        // Expandable accordion item
        html += '<div class="vc-acc-item" style="margin-bottom:10px;">'
          + '<button class="vc-acc-trigger" onclick="toggleAccordion(this)" style="display:flex;align-items:center;justify-content:space-between;width:100%;'
          + 'background:#1A2C5B;border:none;border-radius:10px;padding:15px 18px;cursor:pointer;">'
          + '<span style="font-family:Inter,sans-serif;font-size:14px;font-weight:600;color:#FFFFFF;text-align:left;">' + item.label + '</span>'
          + '<span class="vc-acc-icon" style="font-size:20px;color:#FFFFFF;font-weight:300;transition:transform 0.3s;line-height:1;">+</span>'
          + '</button>'
          + '<div class="vc-acc-panel" style="max-height:0;overflow:hidden;transition:max-height 0.4s ease;border-radius:0 0 10px 10px;">'
          + '<div style="padding:16px 18px;background:#FFFFFF;border:1px solid #E5E7EB;border-top:none;border-radius:0 0 10px 10px;">'
          + item.content
          + '</div>'
          + '</div>'
          + '</div>';
      }
    }

    html += '</div>';
    return html;
  }

  // SECTION 9: Social Connect Icons
  function buildSocialConnect(d) {
    var social = d.socialLinks || {};

    var platforms = [
      { key: 'facebook',  bg: '#1877F2',  icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>' },
      { key: 'instagram', bg: 'linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>' },
      { key: 'linkedin',  bg: '#0A66C2',  icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>' },
      { key: 'twitter',   bg: '#000000',  icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>' },
      { key: 'youtube',   bg: '#FF0000',  icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>' },
      { key: 'tiktok',    bg: '#000000',  icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>' },
    ];

    var hasAny = false;
    for (var ci = 0; ci < platforms.length; ci++) {
      if (social[platforms[ci].key]) { hasAny = true; break; }
    }

    var iconsHTML = '';
    if (hasAny) {
      for (var i = 0; i < platforms.length; i++) {
        var p = platforms[i];
        if (social[p.key]) {
          iconsHTML += '<a href="' + esc(social[p.key]) + '" target="_blank" style="width:48px;height:48px;border-radius:50%;background:' + p.bg + ';display:inline-flex;align-items:center;justify-content:center;text-decoration:none;transition:transform 0.2s;">'
            + p.icon + '</a>';
        }
      }
    } else {
      // 3 greyed out placeholders
      for (var j = 0; j < 3; j++) {
        iconsHTML += '<div style="width:48px;height:48px;border-radius:50%;background:#D1D5DB;display:inline-flex;align-items:center;justify-content:center;">'
          + '<svg width="18" height="18" viewBox="0 0 24 24" fill="#9CA3AF"><circle cx="12" cy="12" r="10"/></svg>'
          + '</div>';
      }
    }

    return '<div style="background:#FFFFFF;padding:24px 20px;text-align:center;">'
      + '<h3 style="font-family:Poppins,sans-serif;font-size:18px;font-weight:700;color:#1A2C5B;margin:0 0 16px;">Let\'s Connect On Social</h3>'
      + '<div style="display:flex;justify-content:center;gap:12px;flex-wrap:wrap;">' + iconsHTML + '</div>'
      + '</div>';
  }

  // SECTION 10: Footer
  function buildFooter(d) {
    var bizName = d.businessName || 'vNetCard\u2122 LLC';
    var city = d.city || d.serviceArea || '';
    var state = d.state || '';
    var location = [city, state].filter(Boolean).join(', ');
    var phone = d.phone || '';
    var website = d.website || '';
    var year = new Date().getFullYear();

    return '<div style="background:linear-gradient(180deg,#1A2C5B 0%,#0F1B3D 100%);padding:36px 24px 20px;text-align:center;">'
      // Large vNetCard logo
      + '<div style="margin-bottom:10px;">' + vnetcardLogo('large') + '</div>'
      + '<p style="font-family:Inter,sans-serif;font-size:14px;color:rgba(255,255,255,0.7);font-style:italic;margin:0 0 20px;">Connect. Share. Grow.</p>'
      + '<div style="width:40px;height:1px;background:rgba(255,255,255,0.2);margin:0 auto 20px;"></div>'
      + '<p style="font-family:Poppins,sans-serif;font-size:15px;font-weight:600;color:#FFFFFF;margin:0 0 4px;">' + esc(bizName) + '</p>'
      + (location ? '<p style="font-family:Inter,sans-serif;font-size:13px;color:rgba(255,255,255,0.6);margin:0 0 4px;">' + esc(location) + '</p>' : '')
      + (phone ? '<p style="font-family:Inter,sans-serif;font-size:13px;color:rgba(255,255,255,0.6);margin:0 0 4px;">' + esc(phone) + '</p>' : '')
      + (website ? '<p style="font-family:Inter,sans-serif;font-size:13px;margin:0 0 16px;"><a href="' + esc(website) + '" target="_blank" style="color:rgba(255,255,255,0.7);text-decoration:none;">' + esc(website.replace(/^https?:\/\//, '')) + '</a></p>' : '<div style="margin-bottom:16px;"></div>')
      // Share icon
      + '<div style="margin-bottom:20px;">'
      + '<button onclick="if(navigator.share){navigator.share({title:\'' + esc(bizName).replace(/'/g, "\\'") + '\',url:window.location.href})}" style="width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;">'
      + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>'
      + '</button>'
      + '</div>'
      // Powered by line
      + '<p style="font-family:Inter,sans-serif;font-size:10px;color:rgba(255,255,255,0.35);margin:0;">'
      + 'Powered By vNetCard\u2122 - a SDVOSB</p>'
      + '<p style="font-family:Inter,sans-serif;font-size:10px;color:rgba(255,255,255,0.25);margin:4px 0 0;">&copy; ' + year + ' All rights reserved.</p>'
      + '</div>';
  }

  // ---------------------------------------------------------------------------
  // CSS
  // ---------------------------------------------------------------------------

  function buildCSS() {
    return '@import url("https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,400;0,500;0,600;0,700;0,800;1,700;1,800&family=Inter:wght@400;500;600;700&display=swap");'
      + '*{margin:0;padding:0;box-sizing:border-box;}'
      + 'html,body{width:100%;min-height:100vh;background:linear-gradient(180deg,#C5A028 0%,#1A2C5B 40%,#0F1B3D 100%);font-family:"Inter",sans-serif;color:#333;-webkit-text-size-adjust:100%;}'
      + '.vc-card{max-width:430px;margin:0 auto;overflow:hidden;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,0.3);}'
      + 'button:focus{outline:none;}'
      + 'a:hover{opacity:0.9;}';
  }

  // ---------------------------------------------------------------------------
  // Inline JS for accordion
  // ---------------------------------------------------------------------------

  function buildInlineJS() {
    return 'function toggleAccordion(btn){'
      + 'var item=btn.parentElement;'
      + 'var panel=item.querySelector(".vc-acc-panel");'
      + 'var icon=btn.querySelector(".vc-acc-icon");'
      + 'var allItems=document.querySelectorAll(".vc-acc-item");'
      + 'var isOpen=panel.style.maxHeight&&panel.style.maxHeight!=="0px";'
      // Close all
      + 'for(var i=0;i<allItems.length;i++){'
      + 'var p=allItems[i].querySelector(".vc-acc-panel");'
      + 'var ic=allItems[i].querySelector(".vc-acc-icon");'
      + 'if(p){p.style.maxHeight="0px";}'
      + 'if(ic){ic.style.transform="rotate(0deg)";ic.textContent="+";}'
      + '}'
      // Toggle current
      + 'if(!isOpen){'
      + 'panel.style.maxHeight=panel.scrollHeight+"px";'
      + 'icon.style.transform="rotate(45deg)";'
      + 'icon.textContent="+";'
      + '}'
      + '}';
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  Generator.generateCardHTML = function (cardData) {
    var d = cardData || {};

    var html = '<!DOCTYPE html>'
      + '<html lang="en">'
      + '<head>'
      + '<meta charset="UTF-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no">'
      + '<title>' + esc(d.businessName || 'vNetCard') + ' - Digital Business Card</title>'
      + '<style>' + buildCSS() + '</style>'
      + '</head>'
      + '<body>'
      + '<div class="vc-card">'
      + buildPoweredByHeader()
      + buildHeroBanner(d)
      + buildNameCard(d)
      + buildContactActions(d)
      + buildUtilityButtons()
      + buildAudioPlayer(d)
      + buildSocialEmbed(d)
      + buildAccordion(d)
      + buildSocialConnect(d)
      + buildFooter(d)
      + '</div>'
      + '<script>' + buildInlineJS() + '<\/script>'
      + '</body>'
      + '</html>';

    return html;
  };

  Generator.exportCardHTML = function (cardData) {
    var d = cardData || {};
    var html = Generator.generateCardHTML(d);
    var filename = slugify(d.businessName || 'vnetcard') + '-vnetcard-preview.html';
    var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  Generator.renderCardPreview = function (cardData, targetIframe) {
    if (!targetIframe) return;
    var html = Generator.generateCardHTML(cardData);
    targetIframe.setAttribute('srcdoc', html);
  };

  window.Generator = Generator;
})();
