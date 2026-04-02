/**
 * vNetCard Studio - Website Scraper & Content Generator
 *
 * Scrapes client websites via CORS proxy to extract content,
 * then auto-generates accordion tab content for the card.
 *
 * Exposes: window.Scraper
 * (c) vNetCard - All rights reserved.
 */

(function () {
  'use strict';

  var Scraper = {};
  var _scrapedData = null;

  // CORS proxies to try (free public proxies)
  var CORS_PROXIES = [
    'https://api.allorigins.win/raw?url=',
    'https://corsproxy.io/?',
  ];

  /**
   * Attempt to fetch a URL through CORS proxies.
   * Returns the HTML string or null.
   */
  async function fetchWithProxy(url) {
    for (var i = 0; i < CORS_PROXIES.length; i++) {
      try {
        var proxyUrl = CORS_PROXIES[i] + encodeURIComponent(url);
        var response = await fetch(proxyUrl, {
          headers: { 'Accept': 'text/html' },
          signal: AbortSignal.timeout(15000)
        });
        if (response.ok) {
          var text = await response.text();
          if (text && text.length > 200) return text;
        }
      } catch (e) {
        console.log('[Scraper] Proxy ' + (i + 1) + ' failed:', e.message);
      }
    }
    return null;
  }

  /**
   * Parse HTML and extract useful content.
   */
  function parseWebsiteContent(html, url) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(html, 'text/html');

    var result = {
      url: url,
      title: '',
      description: '',
      headings: [],
      paragraphs: [],
      services: [],
      about: '',
      faqs: [],
      testimonials: [],
      metaKeywords: '',
      ogImage: '',
    };

    // Title
    var titleEl = doc.querySelector('title');
    if (titleEl) result.title = titleEl.textContent.trim();

    // Meta description
    var metaDesc = doc.querySelector('meta[name="description"]');
    if (metaDesc) result.description = metaDesc.getAttribute('content') || '';

    // Meta keywords
    var metaKw = doc.querySelector('meta[name="keywords"]');
    if (metaKw) result.metaKeywords = metaKw.getAttribute('content') || '';

    // OG image
    var ogImg = doc.querySelector('meta[property="og:image"]');
    if (ogImg) result.ogImage = ogImg.getAttribute('content') || '';

    // Headings
    var headings = doc.querySelectorAll('h1, h2, h3');
    for (var h = 0; h < Math.min(headings.length, 20); h++) {
      var txt = headings[h].textContent.trim();
      if (txt.length > 2 && txt.length < 200) {
        result.headings.push(txt);
      }
    }

    // Paragraphs (meaningful ones)
    var paras = doc.querySelectorAll('p');
    for (var p = 0; p < paras.length; p++) {
      var pText = paras[p].textContent.trim();
      if (pText.length > 40 && pText.length < 1000) {
        result.paragraphs.push(pText);
        if (result.paragraphs.length >= 15) break;
      }
    }

    // Try to find services/about sections
    var allSections = doc.querySelectorAll('section, div, article');
    for (var s = 0; s < allSections.length; s++) {
      var section = allSections[s];
      var sectionText = (section.className + ' ' + (section.id || '')).toLowerCase();

      if (sectionText.match(/service|what-we-do|offering/)) {
        var liItems = section.querySelectorAll('li, h3, h4');
        for (var li = 0; li < liItems.length; li++) {
          var liText = liItems[li].textContent.trim();
          if (liText.length > 2 && liText.length < 100) {
            result.services.push(liText);
          }
        }
      }

      if (sectionText.match(/about|mission|story|who-we/)) {
        var aboutParas = section.querySelectorAll('p');
        for (var ap = 0; ap < aboutParas.length; ap++) {
          var apText = aboutParas[ap].textContent.trim();
          if (apText.length > 30) {
            result.about += apText + ' ';
          }
        }
      }

      if (sectionText.match(/faq|question|accordion/)) {
        var faqHeadings = section.querySelectorAll('h3, h4, button, summary, dt');
        var faqAnswers = section.querySelectorAll('p, dd, div[class*="answer"], div[class*="content"]');
        for (var fi = 0; fi < Math.min(faqHeadings.length, faqAnswers.length, 8); fi++) {
          var q = faqHeadings[fi].textContent.trim();
          var a = faqAnswers[fi].textContent.trim();
          if (q.length > 5 && a.length > 10) {
            result.faqs.push({ q: q, a: a });
          }
        }
      }

      if (sectionText.match(/testimonial|review|client-say/)) {
        var quotes = section.querySelectorAll('blockquote, p, div[class*="quote"], div[class*="text"]');
        for (var ti = 0; ti < Math.min(quotes.length, 5); ti++) {
          var quote = quotes[ti].textContent.trim();
          if (quote.length > 20 && quote.length < 500) {
            result.testimonials.push(quote);
          }
        }
      }
    }

    // Deduplicate services
    result.services = result.services.filter(function (v, i, a) { return a.indexOf(v) === i; }).slice(0, 12);
    result.about = result.about.trim().substring(0, 800);

    return result;
  }

  /**
   * Scrape a website URL. Returns parsed data or null.
   */
  Scraper.scrapeWebsite = async function (url) {
    if (!url || url === 'N/A' || url === 'n/a') return null;

    // Normalize URL
    if (!url.match(/^https?:\/\//)) {
      url = 'https://' + url;
    }

    var html = await fetchWithProxy(url);
    if (!html) return null;

    _scrapedData = parseWebsiteContent(html, url);
    return _scrapedData;
  };

  /**
   * Get the last scraped data.
   */
  Scraper.getScrapedData = function () {
    return _scrapedData;
  };

  /**
   * Generate accordion tab content based on scraped data + user inputs.
   *
   * @param {Object} opts
   * @param {Object} opts.scraped - scraped website data (can be null)
   * @param {string} opts.businessName
   * @param {string} opts.aboutCompany
   * @param {string} opts.servicesOffered
   * @param {string} opts.shortBio
   * @param {string} opts.industry
   * @param {string} opts.website
   * @param {string} opts.contactName
   * @param {string} opts.phone
   * @param {string} opts.email
   * @returns {Array} Array of { title, content, type } tab objects
   */
  Scraper.generateTabContent = function (opts) {
    var scraped = opts.scraped || {};
    var bizName = opts.businessName || 'the business';
    var about = opts.aboutCompany || scraped.about || '';
    var services = opts.servicesOffered || '';
    var bio = opts.shortBio || '';
    var industry = opts.industry || '';
    var website = opts.website || '';
    var contactName = opts.contactName || '';
    var phone = opts.phone || '';
    var email = opts.email || '';

    // Use scraped data to enrich content
    var scrapedParagraphs = (scraped.paragraphs || []).join('\n\n');
    var scrapedServices = (scraped.services || []).join(', ');
    var scrapedFaqs = scraped.faqs || [];
    var scrapedDesc = scraped.description || '';

    var tabs = [];

    // 1. Explainer Video tab (always)
    tabs.push({
      title: bizName + ' Explainer Video',
      content: 'Watch this short video to learn more about ' + bizName + ' and the services we offer. See why our clients trust us for their ' + (industry || 'business') + ' needs.',
      type: 'video'
    });

    // 2. What Is [Business]?
    var whatIsContent = about || scrapedDesc || scrapedParagraphs.substring(0, 400);
    if (!whatIsContent) {
      whatIsContent = bizName + ' is a trusted ' + (industry || 'business') + ' provider dedicated to delivering exceptional service and results for every client.';
    }
    tabs.push({
      title: 'What Is ' + bizName + '?',
      content: whatIsContent.substring(0, 600),
      type: 'about'
    });

    // 3. A Better Way To Connect
    tabs.push({
      title: 'A Better Way To Connect',
      content: 'Your vNetCard\u2122 digital business card makes it easy to share your contact info, services, and more with a single tap. No more lost paper cards \u2014 your professional profile is always accessible, always up-to-date.',
      type: 'connect'
    });

    // 4. 10 Reasons To Get vNetCard
    tabs.push({
      title: '10 Reasons To Get vNetCard\u2122',
      content: '1. Instant contact sharing\n2. Always up-to-date information\n3. Professional first impression\n4. Eco-friendly \u2014 no paper waste\n5. Built-in appointment booking\n6. Review collection made easy\n7. Social media integration\n8. Works on any device\n9. Analytics and insights\n10. Unlimited shares',
      type: 'reasons'
    });

    // 5. Get Started Now
    tabs.push({
      title: 'Get Started Now',
      content: 'Ready to elevate your networking? Contact ' + (contactName || bizName) + ' today to get started with your own vNetCard\u2122 digital business card.' + (phone ? '\n\nCall: ' + phone : '') + (email ? '\nEmail: ' + email : ''),
      type: 'cta'
    });

    // 6. Visit Our Website
    if (website && website !== 'N/A') {
      tabs.push({
        title: 'Visit Our Website',
        content: 'Learn more about ' + bizName + ' and explore our full range of services at our website.\n\n' + website,
        type: 'website'
      });
    }

    // 7. Services (from user input or scraped)
    var serviceContent = services || scrapedServices;
    if (serviceContent) {
      tabs.push({
        title: 'Our Services',
        content: bizName + ' offers a comprehensive range of services:\n\n' + serviceContent,
        type: 'services'
      });
    }

    // 8. Got Questions? Contact Us
    tabs.push({
      title: 'Got Questions? Contact Us',
      content: 'Have questions about our services? We\'d love to hear from you!\n\n' + (phone ? 'Phone: ' + phone + '\n' : '') + (email ? 'Email: ' + email + '\n' : '') + (website ? 'Web: ' + website : ''),
      type: 'contact'
    });

    // 9. Chat 24/7 With Our AI Assistant
    tabs.push({
      title: 'Chat 24/7 With Our AI Assistant',
      content: 'Can\'t reach us right now? Our AI-powered assistant is available 24/7 to answer your questions about ' + bizName + '\'s services, pricing, and availability. Get instant help anytime!',
      type: 'chat'
    });

    // 10. Become A vNetCard Affiliate
    tabs.push({
      title: 'Become A vNetCard\u2122 Affiliate',
      content: 'Love your vNetCard\u2122? Earn rewards by referring other business owners! Join our affiliate program and help fellow professionals upgrade their networking game. Contact us to learn more about partnership opportunities.',
      type: 'affiliate'
    });

    // 11. Book A Call
    tabs.push({
      title: 'Book A Call',
      content: 'Schedule a free consultation with ' + (contactName || bizName) + '. We\'ll discuss your needs and how we can help.' + (phone ? '\n\nOr call directly: ' + phone : ''),
      type: 'booking'
    });

    // 12. Business Growth Resources
    tabs.push({
      title: 'Business Growth Resources',
      content: 'Explore resources, tips, and tools to help grow your business. From marketing strategies to operational efficiency, ' + bizName + ' is here to support your success.',
      type: 'resources'
    });

    // 13. Read My Reviews
    var reviewContent = '';
    if (scraped.testimonials && scraped.testimonials.length > 0) {
      reviewContent = scraped.testimonials.slice(0, 3).map(function (t, i) {
        return '"' + t + '"';
      }).join('\n\n');
    } else {
      reviewContent = 'See what our clients are saying about ' + bizName + '! We pride ourselves on delivering exceptional service and building lasting relationships with every customer.';
    }
    tabs.push({
      title: 'Read My Reviews',
      content: reviewContent,
      type: 'reviews'
    });

    // 14. Leave A Review
    tabs.push({
      title: 'Leave A Review',
      content: 'Had a great experience with ' + bizName + '? We\'d appreciate your feedback! Your review helps other customers find quality ' + (industry || 'service') + ' providers and helps us continue improving.',
      type: 'review-cta'
    });

    // 15. FAQs (from scraped or industry defaults)
    if (scrapedFaqs.length > 0) {
      var faqContent = scrapedFaqs.slice(0, 5).map(function (f) {
        return 'Q: ' + f.q + '\nA: ' + f.a;
      }).join('\n\n');
      tabs.push({
        title: 'Frequently Asked Questions',
        content: faqContent,
        type: 'faq'
      });
    }

    return tabs;
  };

  window.Scraper = Scraper;
})();
