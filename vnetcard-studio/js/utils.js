/**
 * vNetCard Studio - Shared Utilities Module
 * Global utility functions for the vNetCard Studio PWA.
 * All functions are exposed on window.Utils.
 *
 * (c) vNetCard - All rights reserved.
 */

(function () {
  'use strict';

  const Utils = {};

  // ─── 1. slugify ────────────────────────────────────────────────────────────
  Utils.slugify = function (text) {
    if (!text) return '';
    return String(text)
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/--+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  // ─── 2. formatPhone ───────────────────────────────────────────────────────
  Utils.formatPhone = function (value) {
    if (!value) return '';
    const digits = String(value).replace(/\D/g, '').slice(0, 10);
    if (digits.length === 0) return '';
    if (digits.length <= 3) return '(' + digits;
    if (digits.length <= 6) return '(' + digits.slice(0, 3) + ') ' + digits.slice(3);
    return '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6);
  };

  // ─── 3. generateInitials ──────────────────────────────────────────────────
  Utils.generateInitials = function (name) {
    if (!name) return '';
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  };

  // ─── 4. hexToRgb ─────────────────────────────────────────────────────────
  Utils.hexToRgb = function (hex) {
    if (!hex) return null;
    const h = String(hex).replace(/^#/, '');
    const full = h.length === 3
      ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
      : h;
    if (full.length !== 6) return null;
    const num = parseInt(full, 16);
    if (isNaN(num)) return null;
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255,
    };
  };

  // ─── 5. darkenColor ───────────────────────────────────────────────────────
  Utils.darkenColor = function (hex, percent) {
    const rgb = Utils.hexToRgb(hex);
    if (!rgb) return hex;
    const factor = 1 - Math.min(Math.max(percent, 0), 100) / 100;
    const r = Math.round(rgb.r * factor);
    const g = Math.round(rgb.g * factor);
    const b = Math.round(rgb.b * factor);
    return '#' + [r, g, b].map(function (c) { return c.toString(16).padStart(2, '0'); }).join('');
  };

  // ─── 6. lightenColor ──────────────────────────────────────────────────────
  Utils.lightenColor = function (hex, percent) {
    const rgb = Utils.hexToRgb(hex);
    if (!rgb) return hex;
    const factor = Math.min(Math.max(percent, 0), 100) / 100;
    const r = Math.round(rgb.r + (255 - rgb.r) * factor);
    const g = Math.round(rgb.g + (255 - rgb.g) * factor);
    const b = Math.round(rgb.b + (255 - rgb.b) * factor);
    return '#' + [r, g, b].map(function (c) { return c.toString(16).padStart(2, '0'); }).join('');
  };

  // ─── 7. debounce ──────────────────────────────────────────────────────────
  Utils.debounce = function (fn, delay) {
    var timer;
    return function () {
      var context = this;
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(context, args);
      }, delay || 300);
    };
  };

  // ─── 8. showToast ─────────────────────────────────────────────────────────
  Utils.showToast = function (message, type) {
    type = type || 'info';

    var container = document.getElementById('vn-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'vn-toast-container';
      container.style.cssText =
        'position:fixed;top:20px;right:20px;z-index:99999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
      document.body.appendChild(container);
    }

    var icons = { success: '\u2705', error: '\u274C', warning: '\u26A0\uFE0F', info: '\u2139\uFE0F' };
    var colors = {
      success: { bg: '#ecfdf5', border: '#10b981', text: '#065f46' },
      error:   { bg: '#fef2f2', border: '#ef4444', text: '#991b1b' },
      warning: { bg: '#fffbeb', border: '#f59e0b', text: '#92400e' },
      info:    { bg: '#eff6ff', border: '#3b82f6', text: '#1e40af' },
    };
    var c = colors[type] || colors.info;

    var toast = document.createElement('div');
    toast.style.cssText =
      'pointer-events:auto;display:flex;align-items:center;gap:8px;padding:12px 16px;' +
      'border-radius:8px;font-family:system-ui,sans-serif;font-size:14px;' +
      'box-shadow:0 4px 12px rgba(0,0,0,0.15);max-width:360px;' +
      'transform:translateX(120%);transition:transform 0.3s ease,opacity 0.3s ease;' +
      'background:' + c.bg + ';border-left:4px solid ' + c.border + ';color:' + c.text + ';';
    toast.innerHTML = '<span>' + (icons[type] || '') + '</span><span>' + Utils.escapeHtml(message) + '</span>';

    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        toast.style.transform = 'translateX(0)';
      });
    });

    // Auto-dismiss
    setTimeout(function () {
      toast.style.transform = 'translateX(120%)';
      toast.style.opacity = '0';
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 350);
    }, 3000);
  };

  // ─── 9. formatDate ────────────────────────────────────────────────────────
  Utils.formatDate = function (isoString) {
    if (!isoString) return '';
    var d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    var months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  };

  // ─── 10. calculateCompleteness ────────────────────────────────────────────
  Utils.calculateCompleteness = function (cardData) {
    if (!cardData) return { score: 0, missing: ['All fields'] };

    var requiredFields = [
      { key: 'name', label: 'Business Name', weight: 15 },
      { key: 'phone', label: 'Phone Number', weight: 12 },
      { key: 'industry', label: 'Industry', weight: 10 },
      { key: 'tagline', label: 'Tagline', weight: 8 },
      { key: 'email', label: 'Email Address', weight: 8 },
    ];

    var optionalFields = [
      { key: 'logo', label: 'Logo', weight: 7 },
      { key: 'website', label: 'Website', weight: 5 },
      { key: 'address', label: 'Address', weight: 5 },
      { key: 'hours', label: 'Business Hours', weight: 5 },
      { key: 'description', label: 'Description', weight: 5 },
      { key: 'socialLinks', label: 'Social Media Links', weight: 4 },
      { key: 'gallery', label: 'Photo Gallery', weight: 4 },
      { key: 'services', label: 'Services', weight: 4 },
      { key: 'faqs', label: 'FAQs', weight: 4 },
      { key: 'trustPills', label: 'Trust Badges', weight: 2 },
      { key: 'primaryColor', label: 'Brand Color', weight: 2 },
    ];

    var allFields = requiredFields.concat(optionalFields);
    var totalWeight = allFields.reduce(function (sum, f) { return sum + f.weight; }, 0);
    var earnedWeight = 0;
    var missing = [];

    allFields.forEach(function (field) {
      var val = cardData[field.key];
      var filled = false;
      if (Array.isArray(val)) {
        filled = val.length > 0;
      } else if (typeof val === 'object' && val !== null) {
        filled = Object.keys(val).length > 0;
      } else {
        filled = val !== undefined && val !== null && String(val).trim() !== '';
      }
      if (filled) {
        earnedWeight += field.weight;
      } else {
        missing.push(field.label);
      }
    });

    return {
      score: Math.round((earnedWeight / totalWeight) * 100),
      missing: missing,
    };
  };

  // ─── 11. getIndustryDefaults ──────────────────────────────────────────────
  var industryData = {
    hvac: {
      tagline: 'Your Comfort Is Our Business',
      trustPills: ['EPA Certified', 'NATE Certified', '24/7 Emergency Service', 'Licensed & Insured', 'Free Estimates'],
      recommendedTabs: [
        { name: 'Services', icon: 'wrench', type: 'services' },
        { name: 'Reviews', icon: 'star', type: 'reviews' },
        { name: 'Book Now', icon: 'calendar', type: 'booking' },
        { name: 'FAQs', icon: 'help-circle', type: 'faq' },
        { name: 'Our Team', icon: 'users', type: 'team' },
      ],
      mediaType: 'video',
      ctaLabel: 'Schedule Service',
      faqDefaults: [
        { q: 'How often should I change my air filter?', a: 'We recommend changing standard air filters every 1-3 months. Homes with pets, allergies, or high dust levels should change filters monthly. A clean filter improves efficiency and air quality.' },
        { q: 'What size HVAC system do I need for my home?', a: 'System size depends on square footage, insulation, window count, climate zone, and ceiling height. We perform a Manual J load calculation to determine the correct size so your system runs efficiently without short-cycling.' },
        { q: 'How can I lower my energy bills?', a: 'Schedule annual maintenance, seal ductwork, upgrade to a programmable or smart thermostat, replace aging equipment with high-SEER units, and keep vents unobstructed. We offer energy audits to pinpoint savings.' },
        { q: 'What is a SEER rating?', a: 'SEER stands for Seasonal Energy Efficiency Ratio. It measures cooling efficiency over a season. Higher SEER means lower operating costs. Current minimum standards require SEER 14-15 depending on your region.' },
        { q: 'Do you offer financing for new systems?', a: 'Yes, we offer flexible financing options with approved credit, including 0% interest promotions. We can walk you through your options during a free in-home estimate.' },
      ],
      serviceCategories: ['AC Repair', 'AC Installation', 'Heating Repair', 'Furnace Installation', 'Duct Cleaning', 'Indoor Air Quality', 'Thermostat Installation', 'Preventive Maintenance', 'Heat Pump Service', 'Emergency HVAC Service'],
    },

    plumbing: {
      tagline: 'Reliable Plumbing You Can Trust',
      trustPills: ['Licensed & Insured', '24/7 Emergency Service', 'Upfront Pricing', 'Satisfaction Guaranteed', 'Background-Checked Technicians'],
      recommendedTabs: [
        { name: 'Services', icon: 'wrench', type: 'services' },
        { name: 'Reviews', icon: 'star', type: 'reviews' },
        { name: 'Book Now', icon: 'calendar', type: 'booking' },
        { name: 'FAQs', icon: 'help-circle', type: 'faq' },
        { name: 'Gallery', icon: 'image', type: 'gallery' },
      ],
      mediaType: 'video',
      ctaLabel: 'Schedule Service',
      faqDefaults: [
        { q: 'What should I do if I have a burst pipe?', a: 'Shut off the main water valve immediately, then call us for emergency service. While you wait, open faucets to relieve pressure and move valuables away from the affected area. We offer 24/7 emergency response.' },
        { q: 'Why is my water heater not producing hot water?', a: 'Common causes include a tripped breaker, faulty thermostat, broken heating element, or sediment buildup in the tank. For gas units, the pilot light may be out. We can diagnose and repair the issue same-day in most cases.' },
        { q: 'How can I prevent clogged drains?', a: 'Use drain screens to catch hair and debris, avoid pouring grease down the kitchen sink, run hot water after each use, and schedule annual drain cleaning. Avoid chemical drain cleaners as they can damage pipes over time.' },
        { q: 'Do you provide free estimates?', a: 'Yes, we provide free estimates for most plumbing projects. For diagnostic work that requires opening walls or using camera inspection, a service fee applies, which we waive if you proceed with the repair.' },
        { q: 'Is repiping my home worth it?', a: 'If your home has galvanized or polybutylene pipes, or you experience frequent leaks and low water pressure, repiping can prevent costly water damage and improve your water quality and pressure significantly.' },
      ],
      serviceCategories: ['Drain Cleaning', 'Water Heater Repair', 'Water Heater Installation', 'Leak Detection', 'Sewer Line Repair', 'Pipe Repair & Repiping', 'Toilet Repair', 'Faucet Installation', 'Garbage Disposal', 'Emergency Plumbing'],
    },

    electrical: {
      tagline: 'Powering Your Home Safely',
      trustPills: ['Licensed Master Electrician', 'Insured & Bonded', 'Code Compliant', '24/7 Emergency Service', 'Free Safety Inspections'],
      recommendedTabs: [
        { name: 'Services', icon: 'zap', type: 'services' },
        { name: 'Reviews', icon: 'star', type: 'reviews' },
        { name: 'Book Now', icon: 'calendar', type: 'booking' },
        { name: 'FAQs', icon: 'help-circle', type: 'faq' },
        { name: 'Our Team', icon: 'users', type: 'team' },
      ],
      mediaType: 'video',
      ctaLabel: 'Schedule Service',
      faqDefaults: [
        { q: 'Why do my circuit breakers keep tripping?', a: 'Frequent tripping usually indicates an overloaded circuit, a short circuit, or a ground fault. It could also signal outdated wiring that cannot handle modern electrical loads. We recommend a panel inspection to identify the root cause.' },
        { q: 'When should I upgrade my electrical panel?', a: 'Consider upgrading if your home still has a fuse box, your panel is rated below 200 amps, you are adding major appliances, or you notice flickering lights and warm outlets. A modern panel improves safety and capacity.' },
        { q: 'How much does it cost to rewire a house?', a: 'Rewiring costs vary based on home size, accessibility, and local codes. A typical 1,500 sq ft home ranges from $8,000 to $15,000. We provide detailed written estimates after an in-home assessment at no charge.' },
        { q: 'Can you install EV charger stations?', a: 'Yes, we install Level 2 EV charging stations for all major vehicle brands. Installation typically requires a dedicated 240V circuit and takes about half a day. We handle permits and inspections.' },
        { q: 'Are your electricians licensed?', a: 'All of our electricians are fully licensed, insured, and background-checked. We carry both general liability and workers compensation insurance for your protection.' },
      ],
      serviceCategories: ['Panel Upgrades', 'Wiring & Rewiring', 'Outlet & Switch Installation', 'Lighting Installation', 'Ceiling Fan Installation', 'EV Charger Installation', 'Generator Installation', 'Surge Protection', 'Electrical Inspections', 'Emergency Electrical Service'],
    },

    'hvac-plumbing-electrical': {
      tagline: 'Your Home Service Experts',
      trustPills: ['Licensed & Insured', '24/7 Emergency Service', 'One-Stop Home Services', 'Upfront Pricing', 'Satisfaction Guaranteed'],
      recommendedTabs: [
        { name: 'Services', icon: 'wrench', type: 'services' },
        { name: 'Reviews', icon: 'star', type: 'reviews' },
        { name: 'Book Now', icon: 'calendar', type: 'booking' },
        { name: 'FAQs', icon: 'help-circle', type: 'faq' },
        { name: 'Our Team', icon: 'users', type: 'team' },
      ],
      mediaType: 'video',
      ctaLabel: 'Schedule Service',
      faqDefaults: [
        { q: 'Do you handle HVAC, plumbing, and electrical?', a: 'Yes, we are a full-service home services company. Our licensed technicians handle heating, cooling, plumbing, and electrical work, so you only need one call for all your home comfort and safety needs.' },
        { q: 'Do you offer maintenance plans?', a: 'We offer comprehensive annual maintenance plans that cover your HVAC system, plumbing fixtures, and electrical panel. Members receive priority scheduling, discounted repairs, and annual safety inspections.' },
        { q: 'What areas do you serve?', a: 'We serve the greater metro area and surrounding communities within a 30-mile radius. Contact us to confirm service availability at your address.' },
        { q: 'Do you offer financing?', a: 'Yes, we partner with leading finance providers to offer flexible payment options on qualifying projects, including 0% interest promotions for new system installations and major home upgrades.' },
        { q: 'How quickly can you respond to emergencies?', a: 'Our emergency team is available 24/7, 365 days a year. In most cases we can have a licensed technician at your door within 60-90 minutes of your call.' },
      ],
      serviceCategories: ['AC Repair & Installation', 'Heating & Furnace Service', 'Drain Cleaning', 'Water Heater Service', 'Electrical Panel Upgrades', 'Wiring & Rewiring', 'Leak Detection', 'Generator Installation', 'Indoor Air Quality', 'Emergency Service'],
    },

    'real-estate': {
      tagline: 'Find Your Dream Home',
      trustPills: ['Licensed Realtor', 'Top Producer', 'Local Market Expert', 'Five-Star Rated', 'Certified Negotiation Expert'],
      recommendedTabs: [
        { name: 'Listings', icon: 'home', type: 'gallery' },
        { name: 'Reviews', icon: 'star', type: 'reviews' },
        { name: 'Contact', icon: 'phone', type: 'contact' },
        { name: 'FAQs', icon: 'help-circle', type: 'faq' },
        { name: 'About', icon: 'user', type: 'about' },
      ],
      mediaType: 'gallery',
      ctaLabel: 'View Listings',
      faqDefaults: [
        { q: 'How much can I afford to spend on a home?', a: 'A general rule is that your monthly housing payment should not exceed 28-30% of your gross monthly income. I recommend getting pre-approved by a lender before starting your search so you know your exact budget.' },
        { q: 'How long does the home buying process take?', a: 'From offer to closing, the process typically takes 30-45 days. Finding the right home can take a few weeks to several months depending on the market and your criteria. Starting with a pre-approval speeds things up.' },
        { q: 'Do I need a real estate agent to buy a home?', a: 'While not legally required, a buyer\'s agent provides expert guidance on pricing, negotiations, inspections, and contracts at no direct cost to you. The seller typically pays the commission.' },
        { q: 'What costs should I expect besides the purchase price?', a: 'Budget for closing costs (2-5% of purchase price), home inspection ($300-$500), appraisal fees, title insurance, and moving expenses. I provide a detailed cost breakdown for every property we consider.' },
        { q: 'How do you market my home when selling?', a: 'I use professional photography, virtual tours, targeted social media advertising, MLS syndication to all major portals, open houses, and my extensive buyer network to maximize exposure and drive offers.' },
      ],
      serviceCategories: ['Buyer Representation', 'Seller Representation', 'Home Valuation', 'Market Analysis', 'First-Time Buyers', 'Investment Properties', 'Relocation Services', 'Luxury Homes'],
    },

    insurance: {
      tagline: 'Protect What Matters Most',
      trustPills: ['Licensed Agent', 'Independent Agency', 'Multiple Carriers', 'Claims Assistance', 'Free Policy Review'],
      recommendedTabs: [
        { name: 'Coverage', icon: 'shield', type: 'services' },
        { name: 'Reviews', icon: 'star', type: 'reviews' },
        { name: 'Get Quote', icon: 'file-text', type: 'booking' },
        { name: 'FAQs', icon: 'help-circle', type: 'faq' },
        { name: 'About', icon: 'user', type: 'about' },
      ],
      mediaType: 'reviews',
      ctaLabel: 'Get a Free Quote',
      faqDefaults: [
        { q: 'How much auto insurance do I actually need?', a: 'At minimum you need your state\'s required liability coverage, but we recommend higher limits plus uninsured motorist coverage. If you have significant assets, an umbrella policy adds an extra layer of protection at a low cost.' },
        { q: 'What factors affect my home insurance premium?', a: 'Key factors include your home\'s age, construction type, location, claims history, credit score, deductible amount, and coverage limits. Bundling with auto, installing security systems, and increasing your deductible can reduce premiums.' },
        { q: 'What is the difference between term and whole life insurance?', a: 'Term life covers you for a specific period (10, 20, or 30 years) and is more affordable. Whole life provides lifelong coverage with a cash value component but costs significantly more. Most families are best served by term life.' },
        { q: 'Can you help me if I need to file a claim?', a: 'Absolutely. We guide you through the entire claims process, from documentation and filing to following up with the carrier and ensuring you receive a fair settlement. We are your advocate.' },
        { q: 'How often should I review my insurance coverage?', a: 'We recommend an annual review, or whenever you experience major life changes such as buying a home, getting married, having children, or starting a business. An outdated policy can leave dangerous coverage gaps.' },
      ],
      serviceCategories: ['Auto Insurance', 'Home Insurance', 'Life Insurance', 'Business Insurance', 'Health Insurance', 'Umbrella Policies', 'Renters Insurance', 'Flood Insurance'],
    },

    'salon-beauty': {
      tagline: 'Where Beauty Meets Confidence',
      trustPills: ['Licensed Stylists', 'Premium Products', 'Online Booking', 'Walk-Ins Welcome', 'Gift Cards Available'],
      recommendedTabs: [
        { name: 'Services', icon: 'scissors', type: 'services' },
        { name: 'Gallery', icon: 'image', type: 'gallery' },
        { name: 'Book Now', icon: 'calendar', type: 'booking' },
        { name: 'Reviews', icon: 'star', type: 'reviews' },
        { name: 'Our Team', icon: 'users', type: 'team' },
      ],
      mediaType: 'gallery',
      ctaLabel: 'Book Appointment',
      faqDefaults: [
        { q: 'Do I need to book an appointment or do you accept walk-ins?', a: 'We accept both, but appointments are recommended to guarantee your preferred stylist and time slot. Walk-ins are accommodated based on availability. You can book online 24/7 through our scheduling page.' },
        { q: 'How should I prepare for a color appointment?', a: 'Arrive with unwashed hair (one day of natural oils helps the color process). Bring reference photos of your desired look. Plan for 2-3 hours for full color services. We will do a consultation before starting.' },
        { q: 'What products do you use?', a: 'We use professional-grade, salon-exclusive products selected for quality and performance. All of our color lines are ammonia-free or low-ammonia. Ask your stylist for specific brand and product recommendations.' },
        { q: 'What is your cancellation policy?', a: 'We require 24-hour notice for cancellations. Late cancellations or no-shows may be subject to a fee equal to 50% of the scheduled service. We understand emergencies happen and handle those on a case-by-case basis.' },
        { q: 'Do you offer bridal or event styling packages?', a: 'Yes, we offer comprehensive bridal and event packages including hair styling, makeup, and a trial run. We recommend booking bridal services at least 3 months in advance. Group rates are available for wedding parties.' },
      ],
      serviceCategories: ['Haircuts & Styling', 'Color & Highlights', 'Balayage & Ombre', 'Blowouts', 'Keratin Treatments', 'Extensions', 'Bridal & Event Styling', 'Nails', 'Facials & Skin Care', 'Waxing'],
    },

    fitness: {
      tagline: 'Transform Your Body, Transform Your Life',
      trustPills: ['Certified Trainers', 'Free Trial Class', 'Flexible Memberships', 'State-of-the-Art Equipment', 'Nutrition Coaching'],
      recommendedTabs: [
        { name: 'Programs', icon: 'activity', type: 'services' },
        { name: 'Schedule', icon: 'calendar', type: 'booking' },
        { name: 'Reviews', icon: 'star', type: 'reviews' },
        { name: 'Gallery', icon: 'image', type: 'gallery' },
        { name: 'FAQs', icon: 'help-circle', type: 'faq' },
      ],
      mediaType: 'video',
      ctaLabel: 'Start Your Journey',
      faqDefaults: [
        { q: 'Do I need to be in shape before starting?', a: 'Not at all. Our programs are designed for all fitness levels, from complete beginners to advanced athletes. Every exercise can be modified to match your current ability, and our trainers will guide you through everything.' },
        { q: 'What should I bring to my first class?', a: 'Bring a water bottle, a towel, and wear comfortable athletic clothing and supportive shoes. We provide all the equipment. Arrive 10 minutes early to complete a brief health questionnaire and get oriented.' },
        { q: 'How often should I work out?', a: 'For general fitness, we recommend 3-5 sessions per week with at least one rest day. Beginners should start with 3 days and gradually increase. Your trainer will design a program that matches your goals and schedule.' },
        { q: 'Do you offer nutrition guidance?', a: 'Yes, we offer nutrition coaching and meal planning as part of our premium memberships. Our certified nutrition coaches will create a personalized plan aligned with your fitness goals, whether that is fat loss, muscle gain, or performance.' },
        { q: 'Can I freeze or cancel my membership?', a: 'You can freeze your membership for up to 3 months per year at no charge. Cancellations require 30 days written notice. No long-term contracts are required on our month-to-month plans.' },
      ],
      serviceCategories: ['Personal Training', 'Group Fitness Classes', 'HIIT Training', 'Yoga', 'Strength Training', 'Cardio Programs', 'Nutrition Coaching', 'Weight Loss Programs', 'Sports Performance', 'Senior Fitness'],
    },

    'law-legal': {
      tagline: 'Fighting For Your Rights',
      trustPills: ['Free Consultation', 'No Win No Fee', 'Board Certified', 'Millions Recovered', 'Confidential & Discreet'],
      recommendedTabs: [
        { name: 'Practice Areas', icon: 'briefcase', type: 'services' },
        { name: 'Results', icon: 'award', type: 'reviews' },
        { name: 'Contact', icon: 'phone', type: 'contact' },
        { name: 'FAQs', icon: 'help-circle', type: 'faq' },
        { name: 'Our Team', icon: 'users', type: 'team' },
      ],
      mediaType: 'reviews',
      ctaLabel: 'Free Consultation',
      faqDefaults: [
        { q: 'How much does a consultation cost?', a: 'Your initial consultation is completely free and confidential. We will review your case, explain your legal options, and outline a strategy. There is no obligation to retain our services after the consultation.' },
        { q: 'How long will my case take?', a: 'Case timelines vary depending on complexity, the opposing party, and the court\'s schedule. Simple matters may resolve in weeks, while complex litigation can take 12-18 months or more. We keep you updated at every stage.' },
        { q: 'What does "no win, no fee" mean?', a: 'It means you pay no attorney fees unless we win your case. Our fee is a percentage of your recovery. If we do not win, you owe us nothing for our legal services. Case expenses are discussed during your consultation.' },
        { q: 'What should I bring to my first meeting?', a: 'Bring any documents related to your case: contracts, correspondence, police reports, medical records, photos, and insurance information. Also prepare a written timeline of events. The more information you provide, the better we can evaluate your case.' },
        { q: 'Do you handle cases outside your local area?', a: 'We are licensed to practice in this state and handle cases statewide. For matters in other jurisdictions, we have a network of trusted partner firms and can coordinate representation or provide referrals.' },
      ],
      serviceCategories: ['Personal Injury', 'Family Law', 'Criminal Defense', 'Estate Planning', 'Business Law', 'Real Estate Law', 'Employment Law', 'Immigration'],
    },

    financial: {
      tagline: 'Secure Your Financial Future',
      trustPills: ['Fiduciary Advisor', 'CFP Certified', 'SEC Registered', 'Fee Transparent', 'Personalized Plans'],
      recommendedTabs: [
        { name: 'Services', icon: 'dollar-sign', type: 'services' },
        { name: 'Reviews', icon: 'star', type: 'reviews' },
        { name: 'Schedule', icon: 'calendar', type: 'booking' },
        { name: 'FAQs', icon: 'help-circle', type: 'faq' },
        { name: 'About', icon: 'user', type: 'about' },
      ],
      mediaType: 'reviews',
      ctaLabel: 'Schedule Consultation',
      faqDefaults: [
        { q: 'What is a fiduciary and why does it matter?', a: 'A fiduciary is legally required to act in your best interest, not earn commissions by selling products. This means our recommendations are based solely on what is best for your financial situation, not what pays us the most.' },
        { q: 'How much money do I need to start investing?', a: 'You can start with any amount. We work with clients at all stages of their financial journey. The most important step is starting early and being consistent. We will build a plan that fits your current budget and grows with you.' },
        { q: 'How do you charge for your services?', a: 'We operate on a transparent fee structure. Depending on the service, we charge a flat fee, hourly rate, or a percentage of assets under management. We never earn hidden commissions or kickbacks. All fees are disclosed upfront.' },
        { q: 'What is the difference between a financial planner and a financial advisor?', a: 'A financial planner typically focuses on comprehensive planning: budgeting, retirement, taxes, estate, and insurance. A financial advisor may focus more on investment management. We provide both under one roof.' },
        { q: 'How often will we meet to review my plan?', a: 'We schedule formal reviews quarterly, with a comprehensive annual review. You can reach us anytime between meetings for questions or life changes. We also proactively reach out when market conditions or tax law changes may affect your plan.' },
      ],
      serviceCategories: ['Retirement Planning', 'Investment Management', 'Tax Planning', 'Estate Planning', 'College Savings', 'Insurance Analysis', 'Debt Management', 'Business Financial Planning'],
    },

    'medical-health': {
      tagline: 'Your Health, Our Priority',
      trustPills: ['Board Certified', 'Accepting New Patients', 'Same-Day Appointments', 'Telehealth Available', 'Most Insurance Accepted'],
      recommendedTabs: [
        { name: 'Services', icon: 'heart', type: 'services' },
        { name: 'Book Visit', icon: 'calendar', type: 'booking' },
        { name: 'Reviews', icon: 'star', type: 'reviews' },
        { name: 'FAQs', icon: 'help-circle', type: 'faq' },
        { name: 'Our Team', icon: 'users', type: 'team' },
      ],
      mediaType: 'reviews',
      ctaLabel: 'Book Appointment',
      faqDefaults: [
        { q: 'Are you accepting new patients?', a: 'Yes, we are currently accepting new patients. You can schedule your first visit online or by calling our office. New patients should arrive 15 minutes early to complete intake paperwork, or download forms from our website in advance.' },
        { q: 'What insurance plans do you accept?', a: 'We accept most major insurance plans including Blue Cross Blue Shield, Aetna, Cigna, UnitedHealthcare, and Medicare. Contact our office to verify your specific plan. We also offer self-pay rates for uninsured patients.' },
        { q: 'Do you offer telehealth appointments?', a: 'Yes, we offer telehealth visits for many types of appointments including follow-ups, medication management, and minor concerns. Telehealth visits are conducted through a secure, HIPAA-compliant video platform.' },
        { q: 'How do I request prescription refills?', a: 'You can request refills through our patient portal, by calling our office during business hours, or by contacting your pharmacy directly and they will fax us the refill request. Please allow 48 hours for processing.' },
        { q: 'What should I bring to my first appointment?', a: 'Bring your photo ID, insurance card, a list of current medications and dosages, any relevant medical records or imaging, and a list of questions or concerns you would like to discuss.' },
      ],
      serviceCategories: ['Primary Care', 'Preventive Medicine', 'Chronic Disease Management', 'Telehealth Visits', 'Annual Physicals', 'Pediatrics', 'Urgent Care', 'Lab Services'],
    },

    roofing: {
      tagline: 'Protecting What Is Over Your Head',
      trustPills: ['Licensed & Insured', 'Free Inspections', 'Storm Damage Experts', 'Manufacturer Certified', '25-Year Warranty'],
      recommendedTabs: [
        { name: 'Services', icon: 'home', type: 'services' },
        { name: 'Gallery', icon: 'image', type: 'gallery' },
        { name: 'Get Estimate', icon: 'file-text', type: 'booking' },
        { name: 'Reviews', icon: 'star', type: 'reviews' },
        { name: 'FAQs', icon: 'help-circle', type: 'faq' },
      ],
      mediaType: 'video',
      ctaLabel: 'Get Free Estimate',
      faqDefaults: [
        { q: 'How do I know if my roof needs to be replaced?', a: 'Signs include missing or curling shingles, granules in your gutters, daylight visible through the attic, sagging areas, and age over 20-25 years. We offer free inspections to assess your roof\'s condition and remaining lifespan.' },
        { q: 'Can you work with my insurance company on storm damage?', a: 'Yes, we are experienced in working with all major insurance carriers. We document the damage thoroughly, meet with the adjuster, and help ensure your claim covers the full scope of necessary repairs or replacement.' },
        { q: 'How long does a roof replacement take?', a: 'A typical residential roof replacement takes 1-3 days depending on size, complexity, and weather. We protect your landscaping, clean up all debris, and perform a final magnetic sweep for nails.' },
        { q: 'What type of roofing material do you recommend?', a: 'The best material depends on your budget, climate, and aesthetic preferences. Architectural shingles offer great value and a 30-year lifespan. Metal roofing lasts 50+ years with lower maintenance. We discuss all options during your estimate.' },
        { q: 'Do you offer warranties on your work?', a: 'We provide a comprehensive workmanship warranty up to 25 years, in addition to the manufacturer\'s material warranty. Our warranties are transferable to new homeowners, adding value to your property.' },
      ],
      serviceCategories: ['Roof Replacement', 'Roof Repair', 'Storm Damage Repair', 'Roof Inspections', 'Gutter Installation', 'Skylight Installation', 'Commercial Roofing', 'Metal Roofing', 'Flat Roof Systems', 'Emergency Tarping'],
    },

    landscaping: {
      tagline: 'Transforming Outdoor Spaces',
      trustPills: ['Licensed & Insured', 'Free Consultations', 'Sustainable Practices', 'Award-Winning Designs', 'Satisfaction Guaranteed'],
      recommendedTabs: [
        { name: 'Services', icon: 'sun', type: 'services' },
        { name: 'Portfolio', icon: 'image', type: 'gallery' },
        { name: 'Get Quote', icon: 'file-text', type: 'booking' },
        { name: 'Reviews', icon: 'star', type: 'reviews' },
        { name: 'FAQs', icon: 'help-circle', type: 'faq' },
      ],
      mediaType: 'gallery',
      ctaLabel: 'Get Free Quote',
      faqDefaults: [
        { q: 'How often should my lawn be mowed?', a: 'During the growing season, we recommend mowing weekly or bi-weekly depending on grass type, rainfall, and time of year. We follow the one-third rule: never cutting more than one-third of the blade height at once for optimal lawn health.' },
        { q: 'When is the best time to start a landscaping project?', a: 'Spring and fall are ideal for most planting and hardscape projects. However, design and planning can start any time. Booking in the off-season can sometimes get you better scheduling and pricing.' },
        { q: 'Do you offer landscape design services?', a: 'Yes, we provide full landscape design including 3D renderings so you can visualize your project before we break ground. Our designers work with you on plant selection, layout, lighting, and hardscape features.' },
        { q: 'How do you handle irrigation?', a: 'We design and install efficient drip and sprinkler irrigation systems with smart controllers that adjust watering based on weather conditions. This keeps your landscape healthy while minimizing water waste and utility costs.' },
        { q: 'What maintenance is included in your service plans?', a: 'Our maintenance plans include mowing, edging, blowing, seasonal cleanups, mulching, fertilization, weed control, and pruning. We customize the plan to your property size and needs, with weekly, bi-weekly, or monthly visit options.' },
      ],
      serviceCategories: ['Lawn Maintenance', 'Landscape Design', 'Hardscaping', 'Irrigation Systems', 'Tree & Shrub Care', 'Seasonal Cleanups', 'Outdoor Lighting', 'Sod Installation', 'Mulching & Bed Maintenance', 'Snow Removal'],
    },

    cleaning: {
      tagline: 'Spotless Every Time, Guaranteed',
      trustPills: ['Bonded & Insured', 'Background-Checked Staff', 'Eco-Friendly Products', 'Satisfaction Guaranteed', 'Online Booking'],
      recommendedTabs: [
        { name: 'Services', icon: 'home', type: 'services' },
        { name: 'Book Now', icon: 'calendar', type: 'booking' },
        { name: 'Reviews', icon: 'star', type: 'reviews' },
        { name: 'Pricing', icon: 'dollar-sign', type: 'pricing' },
        { name: 'FAQs', icon: 'help-circle', type: 'faq' },
      ],
      mediaType: 'gallery',
      ctaLabel: 'Book Cleaning',
      faqDefaults: [
        { q: 'Do I need to be home during the cleaning?', a: 'No, many of our clients provide a key, garage code, or smart lock access. All of our cleaners are background-checked, bonded, and insured. You can also be home if you prefer.' },
        { q: 'What cleaning products do you use?', a: 'We use eco-friendly, non-toxic cleaning products that are safe for children, pets, and people with allergies. If you have a preferred product or specific sensitivities, we are happy to accommodate your requests.' },
        { q: 'How long does a typical cleaning take?', a: 'A standard cleaning for a 2-3 bedroom home takes approximately 2-3 hours. Deep cleans and move-in/move-out cleans take longer. We will provide a time estimate based on your home size and service level.' },
        { q: 'What if I am not satisfied with the cleaning?', a: 'We stand behind our work with a 100% satisfaction guarantee. If anything does not meet your expectations, contact us within 24 hours and we will re-clean the area at no additional charge.' },
        { q: 'How do I prepare for my cleaning appointment?', a: 'Pick up clutter so our team can focus on deep cleaning surfaces, floors, and fixtures. Secure valuables and fragile items, and let us know about any areas needing special attention or that should be avoided.' },
      ],
      serviceCategories: ['Residential Cleaning', 'Deep Cleaning', 'Move-In/Move-Out Cleaning', 'Office Cleaning', 'Post-Construction Cleaning', 'Carpet Cleaning', 'Window Cleaning', 'Recurring Service Plans'],
    },

    automotive: {
      tagline: 'Expert Auto Care You Can Trust',
      trustPills: ['ASE Certified', 'All Makes & Models', 'Warranty Approved', '12-Month Guarantee', 'Free Diagnostic Check'],
      recommendedTabs: [
        { name: 'Services', icon: 'tool', type: 'services' },
        { name: 'Reviews', icon: 'star', type: 'reviews' },
        { name: 'Book Now', icon: 'calendar', type: 'booking' },
        { name: 'FAQs', icon: 'help-circle', type: 'faq' },
        { name: 'Gallery', icon: 'image', type: 'gallery' },
      ],
      mediaType: 'video',
      ctaLabel: 'Schedule Service',
      faqDefaults: [
        { q: 'How often should I get an oil change?', a: 'For conventional oil, every 3,000-5,000 miles. For synthetic oil, every 7,500-10,000 miles or as recommended by your vehicle manufacturer. We check your owner\'s manual and advise based on your driving habits.' },
        { q: 'Will service at your shop void my warranty?', a: 'No. Federal law (Magnuson-Moss Warranty Act) protects your right to have your vehicle serviced at any qualified shop without voiding the manufacturer warranty. We use OEM or equivalent parts and document all service.' },
        { q: 'How do I know if I need new brakes?', a: 'Warning signs include squealing or grinding noises, a soft or pulsating brake pedal, pulling to one side when braking, and longer stopping distances. We recommend a brake inspection every 12,000 miles or annually.' },
        { q: 'Do you work on all vehicle makes and models?', a: 'Yes, our ASE-certified technicians work on all domestic and import vehicles, including trucks and SUVs. We use the latest diagnostic equipment and have access to manufacturer service data for accurate repairs.' },
        { q: 'Do you offer a shuttle or loaner vehicle?', a: 'We offer a complimentary local shuttle service and a comfortable waiting area with Wi-Fi. For longer repairs, loaner vehicles may be available by reservation. Ask when scheduling your appointment.' },
      ],
      serviceCategories: ['Oil Changes', 'Brake Service', 'Tire Sales & Service', 'Engine Diagnostics', 'Transmission Service', 'A/C Service', 'Alignment & Suspension', 'State Inspections', 'Battery & Electrical', 'Scheduled Maintenance'],
    },

    restaurant: {
      tagline: 'Fresh Flavors, Memorable Moments',
      trustPills: ['Locally Sourced', 'Health Dept A-Rated', 'Award-Winning Chef', 'Online Ordering', 'Catering Available'],
      recommendedTabs: [
        { name: 'Menu', icon: 'book-open', type: 'menu' },
        { name: 'Gallery', icon: 'image', type: 'gallery' },
        { name: 'Order Now', icon: 'shopping-bag', type: 'ordering' },
        { name: 'Reviews', icon: 'star', type: 'reviews' },
        { name: 'Events', icon: 'calendar', type: 'events' },
      ],
      mediaType: 'gallery',
      ctaLabel: 'Order Now',
      faqDefaults: [
        { q: 'Do you accommodate dietary restrictions and allergies?', a: 'Absolutely. Our menu includes vegetarian, vegan, and gluten-free options. Please inform your server about any allergies and our kitchen will prepare your meal accordingly. We take food allergies very seriously.' },
        { q: 'Do you take reservations?', a: 'Yes, we accept reservations online through our booking system or by phone. Walk-ins are always welcome but may experience a wait during peak hours. For parties of 8 or more, a reservation is strongly recommended.' },
        { q: 'Do you offer catering?', a: 'Yes, we cater events of all sizes from business lunches to weddings. Our catering menu features our most popular dishes in shareable formats. Contact us at least one week in advance for catering orders.' },
        { q: 'Do you have a kids menu?', a: 'Yes, we offer a kids menu with smaller portions and family-friendly prices for children 12 and under. All kids meals include a drink and a side.' },
        { q: 'What are your hours of operation?', a: 'We are open for lunch and dinner seven days a week. Check our hours tab or contact us for holiday hours. Happy hour runs Monday through Friday from 4-6 PM with special pricing on appetizers and drinks.' },
      ],
      serviceCategories: ['Dine-In', 'Takeout', 'Delivery', 'Catering', 'Private Events', 'Happy Hour', 'Brunch', 'Late Night'],
    },

    retail: {
      tagline: 'Discover Something You Will Love',
      trustPills: ['Locally Owned', 'Free Shipping', 'Easy Returns', 'Loyalty Rewards', 'Gift Wrapping'],
      recommendedTabs: [
        { name: 'Shop', icon: 'shopping-bag', type: 'gallery' },
        { name: 'Reviews', icon: 'star', type: 'reviews' },
        { name: 'Contact', icon: 'phone', type: 'contact' },
        { name: 'FAQs', icon: 'help-circle', type: 'faq' },
        { name: 'About', icon: 'info', type: 'about' },
      ],
      mediaType: 'gallery',
      ctaLabel: 'Shop Now',
      faqDefaults: [
        { q: 'What is your return policy?', a: 'We accept returns within 30 days of purchase with the original receipt. Items must be in original condition with tags attached. We offer exchanges, store credit, or a refund to the original payment method.' },
        { q: 'Do you offer gift cards?', a: 'Yes, we offer physical and digital gift cards in any amount. Digital gift cards are delivered instantly by email. Physical cards are available in-store and can be shipped anywhere.' },
        { q: 'Do you ship orders?', a: 'Yes, we ship nationwide. Standard shipping is free on orders over $50 and takes 3-5 business days. Expedited and next-day options are available at checkout. Local customers can choose free in-store pickup.' },
        { q: 'Do you have a loyalty or rewards program?', a: 'Yes, our loyalty program is free to join. Earn 1 point per dollar spent and receive a $10 reward for every 100 points. Members also get early access to sales, birthday discounts, and exclusive offers.' },
        { q: 'Can I place a special or custom order?', a: 'Absolutely. If you are looking for a specific item, size, or color we do not currently carry, let us know and we will do our best to source it for you, often within one to two weeks.' },
      ],
      serviceCategories: ['New Arrivals', 'Best Sellers', 'Sale Items', 'Gift Cards', 'Custom Orders', 'Personal Shopping', 'In-Store Pickup', 'Corporate Gifting'],
    },

    'coaching-consulting': {
      tagline: 'Unlock Your Full Potential',
      trustPills: ['Certified Coach', 'Proven Framework', 'Free Discovery Call', '100+ Clients Served', 'Measurable Results'],
      recommendedTabs: [
        { name: 'Programs', icon: 'target', type: 'services' },
        { name: 'About', icon: 'user', type: 'about' },
        { name: 'Book Call', icon: 'phone', type: 'booking' },
        { name: 'Reviews', icon: 'star', type: 'reviews' },
        { name: 'FAQs', icon: 'help-circle', type: 'faq' },
      ],
      mediaType: 'video',
      ctaLabel: 'Book Discovery Call',
      faqDefaults: [
        { q: 'What happens on a discovery call?', a: 'The discovery call is a free, no-obligation 30-minute conversation where we discuss your goals, current challenges, and whether my coaching approach is the right fit. You will walk away with at least one actionable insight regardless.' },
        { q: 'How is coaching different from consulting?', a: 'Coaching helps you develop your own solutions through guided questioning and accountability. Consulting provides expert advice and done-for-you strategies. I offer both, and we will determine the best approach based on your needs.' },
        { q: 'How long does a typical coaching engagement last?', a: 'Most clients see meaningful results within a 3-month engagement meeting bi-weekly. Complex goals like business scaling or career transitions may benefit from a 6-month program. We design the engagement around your specific objectives.' },
        { q: 'Do you work with individuals or organizations?', a: 'Both. I work with individuals on personal development and career growth, and with organizations on leadership development, team performance, and strategic planning. Group workshops and corporate programs are available.' },
        { q: 'What results can I expect?', a: 'Results vary by engagement, but clients typically report clearer decision-making, improved productivity, stronger leadership skills, and progress on goals they have been stuck on. I track measurable outcomes and adjust our approach based on what is working.' },
      ],
      serviceCategories: ['1-on-1 Coaching', 'Group Programs', 'Executive Coaching', 'Business Strategy', 'Leadership Development', 'Workshops & Seminars', 'Online Courses', 'VIP Intensives'],
    },

    other: {
      tagline: 'Professional Service You Can Count On',
      trustPills: ['Licensed & Insured', 'Locally Owned', 'Free Estimates', 'Satisfaction Guaranteed', '5-Star Rated'],
      recommendedTabs: [
        { name: 'Services', icon: 'briefcase', type: 'services' },
        { name: 'Reviews', icon: 'star', type: 'reviews' },
        { name: 'Contact', icon: 'phone', type: 'contact' },
        { name: 'FAQs', icon: 'help-circle', type: 'faq' },
        { name: 'About', icon: 'user', type: 'about' },
      ],
      mediaType: 'gallery',
      ctaLabel: 'Get in Touch',
      faqDefaults: [
        { q: 'What areas do you serve?', a: 'We serve the local area and surrounding communities. Contact us to confirm availability at your location. We are happy to discuss your needs and determine if we can help.' },
        { q: 'How do I get a quote?', a: 'Contact us by phone, email, or through our online form for a free, no-obligation quote. We typically respond within one business day and can often provide a same-day estimate.' },
        { q: 'Are you licensed and insured?', a: 'Yes, we are fully licensed and carry comprehensive insurance. We are happy to provide proof of insurance and any relevant certifications upon request.' },
        { q: 'What forms of payment do you accept?', a: 'We accept all major credit cards, checks, and electronic payments. For larger projects, we offer financing options with approved credit. Payment terms are discussed before work begins.' },
        { q: 'Do you offer any guarantees?', a: 'We stand behind our work with a satisfaction guarantee. If you are not happy with the results, we will make it right. Specific warranty terms are provided in writing with your service agreement.' },
      ],
      serviceCategories: ['General Services', 'Consultations', 'Custom Projects', 'Maintenance Plans', 'Emergency Service'],
    },
  };

  Utils.getIndustryDefaults = function (industry) {
    if (!industry) return industryData.other;
    var key = Utils.slugify(industry);
    // Try direct match, then partial matches
    if (industryData[key]) return industryData[key];
    // Check for partial matches
    var keys = Object.keys(industryData);
    for (var i = 0; i < keys.length; i++) {
      if (key.indexOf(keys[i]) !== -1 || keys[i].indexOf(key) !== -1) {
        return industryData[keys[i]];
      }
    }
    return industryData.other;
  };

  // ─── 12. getIndustryIcon ──────────────────────────────────────────────────
  Utils.getIndustryIcon = function (industry) {
    var icons = {
      'hvac': '\uD83D\uDD27',                        // wrench
      'plumbing': '\uD83D\uDEBF',                     // shower
      'electrical': '\uD83D\uDD0C',                    // plug
      'hvac-plumbing-electrical': '\uD83C\uDFE0',     // house
      'real-estate': '\uD83C\uDFE1',                   // house with garden
      'insurance': '\uD83D\uDEE1\uFE0F',              // shield
      'salon-beauty': '\uD83D\uDC87',                 // person getting haircut
      'fitness': '\uD83C\uDFCB\uFE0F',                // person lifting weights
      'law-legal': '\u2696\uFE0F',                     // balance scale
      'financial': '\uD83D\uDCB0',                     // money bag
      'medical-health': '\uD83C\uDFE5',               // hospital
      'roofing': '\uD83C\uDFDA\uFE0F',                // classical building
      'landscaping': '\uD83C\uDF3F',                   // herb
      'cleaning': '\u2728',                             // sparkles
      'automotive': '\uD83D\uDE97',                    // car
      'restaurant': '\uD83C\uDF7D\uFE0F',             // plate with cutlery
      'retail': '\uD83D\uDECD\uFE0F',                 // shopping bags
      'coaching-consulting': '\uD83C\uDFAF',          // direct hit / target
      'other': '\uD83D\uDCBC',                         // briefcase
    };
    var key = industry ? Utils.slugify(industry) : 'other';
    if (icons[key]) return icons[key];
    var keys = Object.keys(icons);
    for (var i = 0; i < keys.length; i++) {
      if (key.indexOf(keys[i]) !== -1 || keys[i].indexOf(key) !== -1) {
        return icons[keys[i]];
      }
    }
    return icons.other;
  };

  // ─── 13. generateId ───────────────────────────────────────────────────────
  Utils.generateId = function () {
    return 'vn_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  };

  // ─── 14. escapeHtml ───────────────────────────────────────────────────────
  Utils.escapeHtml = function (str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(String(str)));
    return div.innerHTML;
  };

  // ─── 15. copyToClipboard ──────────────────────────────────────────────────
  Utils.copyToClipboard = function (text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        Utils.showToast('Copied to clipboard', 'success');
      }).catch(function () {
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }

    function fallbackCopy(t) {
      var textarea = document.createElement('textarea');
      textarea.value = t;
      textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        Utils.showToast('Copied to clipboard', 'success');
      } catch (e) {
        Utils.showToast('Failed to copy', 'error');
      }
      document.body.removeChild(textarea);
    }
  };

  // ─── Expose on window ─────────────────────────────────────────────────────
  window.Utils = Utils;

})();
