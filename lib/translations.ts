// ─────────────────────────────────────────────────────────────────────────────
// GasCap™ — UI translations  (English + Spanish)
// Add new keys to BOTH locales.  Spanish uses informal "tú" address.
// ─────────────────────────────────────────────────────────────────────────────

export type Locale = 'en' | 'es';

export type Translations = typeof en;

// ── English ──────────────────────────────────────────────────────────────────
const en = {

  // ── Navigation / Auth ──────────────────────────────────────────────────────
  nav: {
    signIn:         'Sign in',
    signUp:         'Sign up',
    signOut:        'Sign out',
    settings:       'Settings',
    upgradeToPro:   'Upgrade to Pro →',
    wrapped:        'Wrapped',
    userMenu:       'User menu',
  },

  // ── Plan badges ────────────────────────────────────────────────────────────
  plan: {
    gascapPro:      'GasCap Pro',
    gascapFleet:    'GasCap Fleet',
    freePlan:       'Free plan · Works offline',
    upgrade:        'Upgrade →',
    freeGuest:      'Free · No account needed · Works offline',
  },

  // ── Header ─────────────────────────────────────────────────────────────────
  header: {
    tagline:        'Know before\nyou go.',
    sub:            'Calculate fuel & cost before you pull up to the pump.',
    realTimePrices: 'Real-time prices',
    worksOffline:   'Works offline',
  },

  // ── Tips ticker ────────────────────────────────────────────────────────────
  tips: [
    "Fill up in the morning — fuel is denser when it's cool, so you get slightly more per gallon.",
    "A dirty air filter can reduce fuel efficiency by up to 10%. Replace it every 15,000 miles.",
    "Under-inflated tires reduce MPG by ~0.2% per 1 PSI drop. Check pressure monthly.",
    "Aggressive acceleration wastes up to 40% more fuel. Accelerate smoothly and steadily.",
    "Highway driving is typically 30–40% more fuel-efficient than stop-and-go city driving.",
    "Replacing a faulty O2 sensor can improve fuel economy by up to 40%.",
    "Every 100 lbs of extra weight reduces MPG by ~1%. Clear out unnecessary cargo.",
    "Cold engines use more fuel. Short trips under 5 miles are especially inefficient.",
    "Cruise control on highways can improve MPG by up to 14% by maintaining steady speed.",
    "Regular oil changes with the right grade oil can improve MPG by 1–2%.",
  ],

  // ── Hero (guest landing) ───────────────────────────────────────────────────
  hero: {
    badge:          'Free · No app store · Works offline',
    headline:       'Know exactly how much gas you need —',
    headlineAccent: 'before you pull up.',
    sub:            'GasCap calculates your exact fill-up cost using live local gas prices. No more guessing, no more overpaying — especially on rental car returns.',
    pill_prices:    'Live local prices',
    pill_rental:    'Rental car mode',
    pill_mpg:       'MPG tracking',
    pill_ai:        'AI advisor',
  },

  // ── Problem / Solution ─────────────────────────────────────────────────────
  problem: {
    heading:    'Stop guessing at the pump',
    sub:        'GasCap solves the three most frustrating gas station moments.',
    rows: [
      {
        before: 'Wondering if you have enough cash to fill up',
        after:  'Know the exact cost before you swipe your card',
      },
      {
        before: 'Returning a rental car on empty — $12/gallon fees',
        after:  'Calculate exactly how many gallons to buy first',
      },
      {
        before: "No idea what you're spending on gas each month",
        after:  'MPG trends and monthly spend tracked automatically',
      },
    ],
  },

  // ── Features ───────────────────────────────────────────────────────────────
  features: {
    heading:  'Everything in one free app',
    items: [
      {
        title: 'Live gas prices',
        body:  'Real-time local prices from the U.S. EIA — automatically localized to your state.',
      },
      {
        title: 'Works offline',
        body:  'Install it like an app. No signal? The calculator always works with your saved data.',
      },
      {
        title: 'MPG & spend tracking',
        body:  'Log every fill-up. See your efficiency trends, monthly spend, and fuel cost per mile.',
      },
      {
        title: 'AI fuel advisor',
        body:  'Ask anything — best fill strategy, octane grade, or how to improve your MPG.',
      },
    ],
    rentalTitle: 'Renting a car? Never overpay at drop-off.',
    rentalBody:  'Rental companies charge up to $12/gal if you return empty. GasCap™ Rental Car Return Mode tells you exactly how many gallons to buy — and shows your exact savings vs. letting them fill it.',
    rentalHint:  'Toggle "🚗 Rental Car Return?" in the calculator above.',
  },

  // ── Use cases ──────────────────────────────────────────────────────────────
  useCases: {
    heading: 'Who uses GasCap™',
    items: [
      {
        who:  'Daily Drivers',
        what: 'Know your fill-up cost every time. Budget your gas spend to the dollar.',
      },
      {
        who:  'Frequent Travelers',
        what: 'Use Rental Car Return Mode to skip the $12/gal refueling trap every trip.',
      },
      {
        who:  'Road Trippers',
        what: 'Plan your fuel budget stop by stop. Know costs before you leave the driveway.',
      },
      {
        who:  'Fleet Managers',
        what: 'Track fuel costs across your entire fleet. Export reports. Control spending.',
      },
    ],
  },

  // ── Stats bar ──────────────────────────────────────────────────────────────
  stats: [
    { value: 'Free',  label: 'Forever — no catch'    },
    { value: '5.0★',  label: 'Average rating'        },
    { value: '<2s',   label: 'Typical calculation'   },
  ],

  // ── FAQ ────────────────────────────────────────────────────────────────────
  faq: {
    heading: 'Frequently Asked Questions',
    items: [
      {
        q: 'How does GasCap calculate how much gas I need?',
        a: 'Enter your current fuel level (or drag the gauge), pick your vehicle, and set your target fill level. GasCap multiplies the gallons needed by your live local gas price — fetched automatically from the U.S. EIA — and shows you the exact cost in seconds.',
      },
      {
        q: 'Is GasCap free?',
        a: 'Yes — the core calculator, live gas prices, and offline access are free forever with no credit card required. Pro ($4.99/mo) adds fill-up history, MPG charts, AI advisor, and PDF export. Fleet ($19.99/mo) adds unlimited vehicles and fleet reporting.',
      },
      {
        q: 'Do I need to download it from the App Store?',
        a: 'No. GasCap is a Progressive Web App (PWA). Visit gascap.app on your phone, tap the Share button, then "Add to Home Screen." It installs like a native app — no App Store or Google Play required.',
      },
      {
        q: 'What is Rental Car Return Mode?',
        a: "It's a special mode that helps you avoid rental company refueling fees. Rental agencies charge up to $12/gallon if you return with less than a full tank. Toggle \"Rental Car Return?\" in the calculator, enter the rental rate, and GasCap shows your exact savings vs. letting them fill it.",
      },
      {
        q: 'How accurate are the gas prices?',
        a: "Very accurate. GasCap pulls weekly data directly from the U.S. Energy Information Administration (EIA) — the official government source. Prices are localized to your state automatically using your device's location.",
      },
      {
        q: 'Does it work offline?',
        a: 'Yes. Once installed as a PWA, the calculator works offline using your last-known gas price and saved vehicles. Live gas price lookup, gauge scanning, and AI features require a connection.',
      },
      {
        q: 'How is this different from a road trip fuel calculator?',
        a: "Road trip calculators estimate fuel cost for a journey by distance. GasCap solves a different problem: it tells you exactly what it costs to fill your tank right now, based on your current level and local price. It's the tool you use at the pump — not while planning a route.",
      },
      {
        q: 'Can GasCap scan my gas gauge?',
        a: "Yes — Pro users can tap \"Scan Gauge\" to take a photo of their dashboard. GasCap's AI reads the needle position and automatically sets your current fuel level. Supports arc, horizontal, and vertical sweep gauges.",
      },
    ],
  },

  // ── Guest CTA banner ───────────────────────────────────────────────────────
  cta: {
    badge:          'Free — no credit card ever',
    headline:       'Know before\nyou pull up.',
    sub:            'Save your vehicles, track your MPG, and stop over-paying at the pump.',
    createAccount:  'Create free account →',
    alreadyHave:    'Already have an account?',
    signIn:         'Sign in',
  },

  // ── Guest save nudge (inline calculator) ──────────────────────────────────
  saveNudge: {
    heading: 'Save your calculations',
    sub:     'Free account — no credit card ever.',
    button:  'Sign up free',
  },

  // ── Sign in page ───────────────────────────────────────────────────────────
  signIn: {
    title:          'Welcome back',
    sub:            'Sign in to your GasCap™ account.',
    emailLabel:     'Email',
    emailHolder:    'you@example.com',
    passwordLabel:  'Password',
    passwordHolder: '••••••••',
    forgotPw:       'Forgot password?',
    button:         'Sign in',
    loading:        'Signing in…',
    noAccount:      "Don't have an account?",
    signUpFree:     'Sign up free',
    continueGuest:  '← Continue without an account',
    errorDefault:   'Incorrect email or password. Please try again.',
    verifiedBanner: {
      title:  "Email verified — you're all set!",
      body:   'Your account is active. Sign in below to go to the calculator.',
    },
  },

  // ── Sign up page ───────────────────────────────────────────────────────────
  signUp: {
    title:            'Create your account',
    sub:              'Free forever. Save your vehicles and calculation history.',
    nameLabel:        'Your name',
    namePlaceholder:  'Alex Johnson',
    emailLabel:       'Email',
    emailHolder:      'you@example.com',
    passwordLabel:    'Password',
    passwordHolder:   '••••••••',
    pwReqs: {
      length:    '8 or more characters',
      uppercase: 'One uppercase letter (A–Z)',
      number:    'One number (0–9)',
      special:   'One special character (!@#$…)',
    },
    button:         'Create free account',
    loading:        'Creating account…',
    trustFree:      '✓ Free forever',
    trustNoCard:    '✓ No credit card',
    trustCancel:    '✓ Cancel anytime',
    haveAccount:    'Already have an account?',
    signIn:         'Sign in',
    continueGuest:  '← Continue without an account',
    termsNote:      'By signing up you agree to our',
    terms:          'Terms of Service',
    and:            'and',
    privacy:        'Privacy Policy',
    referralBanner: {
      title: 'You were invited!',
      body1: 'Referral code',
      body2: "applied. Sign up and your friend earns a free month of Pro.",
    },
    errors: {
      noName:   'Please enter your name.',
      pwReqs:   'Please meet all password requirements.',
      fallback: 'Registration failed.',
    },
  },

  // ── Upgrade page ───────────────────────────────────────────────────────────
  upgrade: {
    title:         'Choose your plan',
    sub:           'Cancel anytime. No hidden fees.',
    monthly:       'Monthly',
    annual:        'Annual',
    saveBadge:     'SAVE 2 MO',
    mostPopular:   'Most Popular',
    proFor:        'For individuals & couples',
    houseAndBiz:   'Household & Business',
    fleetFor:      'Unlimited vehicles · household or business',
    upgradeBtn:    'Upgrade to',
    signInToUp:    'Sign in to upgrade',
    redirecting:   'Redirecting…',
    enterprise:    'Need 50+ vehicles?',
    contactUs:     'Contact us for Enterprise pricing',
    freeForever:   '$0 / forever',
    safeguardTitle:'🔒 Plan limits enforced automatically',
    safeguardBody: 'Free accounts are limited to 1 vehicle. Pro accounts are limited to 3 vehicles — perfect for individuals and couples. When you reach your limit, you\'ll be prompted to upgrade — no surprises. Fleet is designed for households and businesses that need more than 3 vehicles.',
    backLink:      '← Back to calculator',
    help:          'Help',
    terms:         'Terms',
    privacy:       'Privacy',
  },

  // ── Footer ─────────────────────────────────────────────────────────────────
  footer: {
    tagline:  'Gas Capacity — Know before you go.',
    poweredBy:'Powered by VNetCard™',
    help:     'Help & Support',
    terms:    'Terms of Service',
    privacy:  'Privacy Policy',
  },
} as const;

// ── Spanish ───────────────────────────────────────────────────────────────────
const es: Translations = {

  nav: {
    signIn:         'Iniciar sesión',
    signUp:         'Registrarse',
    signOut:        'Cerrar sesión',
    settings:       'Configuración',
    upgradeToPro:   'Mejorar a Pro →',
    wrapped:        'Resumen',
    userMenu:       'Menú de usuario',
  },

  plan: {
    gascapPro:      'GasCap Pro',
    gascapFleet:    'GasCap Flota',
    freePlan:       'Plan gratuito · Funciona sin internet',
    upgrade:        'Mejorar →',
    freeGuest:      'Gratis · Sin cuenta · Funciona sin internet',
  },

  header: {
    tagline:        'Sabe antes\nde llegar.',
    sub:            'Calcula combustible y costo antes de llegar a la gasolinera.',
    realTimePrices: 'Precios en tiempo real',
    worksOffline:   'Funciona sin internet',
  },

  tips: [
    "Llena el tanque por la mañana — el combustible es más denso con el frío y obtienes un poco más por galón.",
    "Un filtro de aire sucio puede reducir la eficiencia de combustible hasta un 10%. Cámbialo cada 15,000 millas.",
    "Las llantas bajas de presión reducen el MPG ~0.2% por cada PSI. Revisa la presión mensualmente.",
    "La aceleración brusca desperdicia hasta un 40% más de combustible. Acelera suavemente.",
    "Manejar en carretera suele ser un 30–40% más eficiente que el tráfico urbano con paradas.",
    "Reemplazar un sensor O2 defectuoso puede mejorar el rendimiento de combustible hasta un 40%.",
    "Cada 100 lbs de peso extra reduce el MPG ~1%. Vacía el maletero de lo innecesario.",
    "Los motores fríos consumen más combustible. Viajes cortos de menos de 5 millas son muy ineficientes.",
    "El control de crucero en carretera puede mejorar el MPG hasta un 14% al mantener velocidad constante.",
    "Los cambios de aceite regulares con el grado correcto pueden mejorar el MPG un 1–2%.",
  ],

  hero: {
    badge:          'Gratis · Sin tienda de apps · Funciona sin internet',
    headline:       'Sabe exactamente cuánta gasolina necesitas —',
    headlineAccent: 'antes de llegar a la bomba.',
    sub:            'GasCap calcula el costo exacto de tu llenado usando precios locales en tiempo real. Sin adivinanzas, sin pagar de más — especialmente al devolver un auto rentado.',
    pill_prices:    'Precios locales',
    pill_rental:    'Modo auto rentado',
    pill_mpg:       'Seguimiento MPG',
    pill_ai:        'Asesor IA',
  },

  problem: {
    heading:    'Deja de adivinar en la gasolinera',
    sub:        'GasCap resuelve los tres momentos más frustrantes en la gasolinera.',
    rows: [
      {
        before: 'Preguntarte si tienes suficiente efectivo para llenar',
        after:  'Sabe el costo exacto antes de pasar tu tarjeta',
      },
      {
        before: 'Devolver un auto rentado casi vacío — cargos de $12/galón',
        after:  'Calcula exactamente cuántos galones comprar primero',
      },
      {
        before: 'Sin idea de cuánto gastas en gasolina al mes',
        after:  'Tendencias de MPG y gasto mensual registrados automáticamente',
      },
    ],
  },

  features: {
    heading:  'Todo en una app gratuita',
    items: [
      {
        title: 'Precios de gasolina en vivo',
        body:  'Precios locales en tiempo real de la EIA de EE.UU. — automáticamente localizados a tu estado.',
      },
      {
        title: 'Funciona sin internet',
        body:  'Instálala como una app. ¿Sin señal? La calculadora siempre funciona con tus datos guardados.',
      },
      {
        title: 'Seguimiento de MPG y gasto',
        body:  'Registra cada llenado. Observa tus tendencias de eficiencia, gasto mensual y costo por milla.',
      },
      {
        title: 'Asesor de combustible IA',
        body:  'Pregunta lo que quieras — mejor estrategia de llenado, grado de octano o cómo mejorar tu MPG.',
      },
    ],
    rentalTitle: '¿Rentando un auto? Nunca pagues de más al devolverlo.',
    rentalBody:  'Las rentadoras cobran hasta $12/galón si lo devuelves vacío. El Modo Devolución de Auto Rentado de GasCap™ te dice exactamente cuántos galones comprar — y te muestra tu ahorro exacto vs. dejar que lo llenen.',
    rentalHint:  'Activa "🚗 ¿Devolución de Auto Rentado?" en la calculadora arriba.',
  },

  useCases: {
    heading: '¿Quién usa GasCap™?',
    items: [
      {
        who:  'Conductores diarios',
        what: 'Sabe el costo de cada llenado. Presupuesta tu gasto en gasolina al centavo.',
      },
      {
        who:  'Viajeros frecuentes',
        what: 'Usa el Modo Auto Rentado para evitar la trampa de $12/galón en cada viaje.',
      },
      {
        who:  'Viajeros de carretera',
        what: 'Planifica tu presupuesto de combustible parada a parada. Sabe los costos antes de salir.',
      },
      {
        who:  'Gestores de flota',
        what: 'Rastrea costos de combustible en toda tu flota. Exporta reportes. Controla el gasto.',
      },
    ],
  },

  stats: [
    { value: 'Gratis', label: 'Para siempre — sin trampa'  },
    { value: '5.0★',   label: 'Calificación promedio'     },
    { value: '<2s',    label: 'Cálculo típico'             },
  ],

  faq: {
    heading: 'Preguntas frecuentes',
    items: [
      {
        q: '¿Cómo calcula GasCap cuánta gasolina necesito?',
        a: 'Ingresa tu nivel de combustible actual (o arrastra el medidor), elige tu vehículo y establece tu nivel objetivo de llenado. GasCap multiplica los galones necesarios por el precio local en tiempo real — obtenido automáticamente de la EIA de EE.UU. — y te muestra el costo exacto en segundos.',
      },
      {
        q: '¿GasCap es gratuito?',
        a: 'Sí — la calculadora básica, los precios de gasolina en tiempo real y el acceso sin conexión son gratuitos para siempre sin tarjeta de crédito. Pro ($4.99/mes) agrega historial de llenados, gráficas de MPG, asesor IA y exportación PDF. Fleet ($19.99/mes) agrega vehículos ilimitados e informes de flota.',
      },
      {
        q: '¿Necesito descargarlo de la App Store?',
        a: 'No. GasCap es una Progressive Web App (PWA). Visita gascap.app en tu teléfono, toca el botón Compartir y luego "Agregar a pantalla de inicio". Se instala como una app nativa — sin App Store ni Google Play.',
      },
      {
        q: '¿Qué es el Modo Devolución de Auto Rentado?',
        a: 'Es un modo especial que te ayuda a evitar cargos de recombustible. Las rentadoras cobran hasta $12/galón si devuelves con menos de un tanque lleno. Activa "¿Devolución de Auto Rentado?" en la calculadora, ingresa la tarifa y GasCap te muestra tu ahorro exacto vs. dejar que lo llenen.',
      },
      {
        q: '¿Qué tan precisos son los precios de gasolina?',
        a: 'Muy precisos. GasCap obtiene datos semanales directamente de la Administración de Información Energética (EIA) de EE.UU. — la fuente oficial del gobierno. Los precios se localizan automáticamente a tu estado usando la ubicación de tu dispositivo.',
      },
      {
        q: '¿Funciona sin conexión a internet?',
        a: 'Sí. Una vez instalada como PWA, la calculadora funciona sin conexión usando tu último precio de gasolina guardado y vehículos guardados. La búsqueda de precios en tiempo real, el escaneo de medidor y las funciones de IA requieren conexión.',
      },
      {
        q: '¿En qué se diferencia de una calculadora de viaje por carretera?',
        a: 'Las calculadoras de viaje estiman el costo de combustible por distancia. GasCap resuelve un problema distinto: te dice exactamente cuánto cuesta llenar tu tanque ahora mismo, según tu nivel actual y el precio local. Es la herramienta que usas en la gasolinera — no mientras planeas la ruta.',
      },
      {
        q: '¿GasCap puede escanear mi medidor de gasolina?',
        a: 'Sí — los usuarios Pro pueden tocar "Escanear Medidor" para tomar una foto del tablero. La IA de GasCap lee la posición de la aguja y establece automáticamente tu nivel de combustible. Compatible con medidores de arco, horizontales y verticales.',
      },
    ],
  },

  cta: {
    badge:          'Gratis — sin tarjeta de crédito nunca',
    headline:       'Sabe antes\nde llegar.',
    sub:            'Guarda tus vehículos, rastrea tu MPG y deja de pagar de más en la gasolinera.',
    createAccount:  'Crear cuenta gratis →',
    alreadyHave:    '¿Ya tienes una cuenta?',
    signIn:         'Iniciar sesión',
  },

  saveNudge: {
    heading: 'Guarda tus cálculos',
    sub:     'Cuenta gratuita — sin tarjeta de crédito nunca.',
    button:  'Registrarse gratis',
  },

  signIn: {
    title:          'Bienvenido de nuevo',
    sub:            'Inicia sesión en tu cuenta GasCap™.',
    emailLabel:     'Correo electrónico',
    emailHolder:    'tú@ejemplo.com',
    passwordLabel:  'Contraseña',
    passwordHolder: '••••••••',
    forgotPw:       '¿Olvidaste tu contraseña?',
    button:         'Iniciar sesión',
    loading:        'Iniciando sesión…',
    noAccount:      '¿No tienes una cuenta?',
    signUpFree:     'Regístrate gratis',
    continueGuest:  '← Continuar sin cuenta',
    errorDefault:   'Correo o contraseña incorrectos. Inténtalo de nuevo.',
    verifiedBanner: {
      title:  '¡Correo verificado — todo listo!',
      body:   'Tu cuenta está activa. Inicia sesión abajo para ir a la calculadora.',
    },
  },

  signUp: {
    title:            'Crea tu cuenta',
    sub:              'Gratis para siempre. Guarda tus vehículos e historial de cálculos.',
    nameLabel:        'Tu nombre',
    namePlaceholder:  'Alex Johnson',
    emailLabel:       'Correo electrónico',
    emailHolder:      'tú@ejemplo.com',
    passwordLabel:    'Contraseña',
    passwordHolder:   '••••••••',
    pwReqs: {
      length:    '8 o más caracteres',
      uppercase: 'Una letra mayúscula (A–Z)',
      number:    'Un número (0–9)',
      special:   'Un carácter especial (!@#$…)',
    },
    button:         'Crear cuenta gratis',
    loading:        'Creando cuenta…',
    trustFree:      '✓ Gratis para siempre',
    trustNoCard:    '✓ Sin tarjeta de crédito',
    trustCancel:    '✓ Cancela cuando quieras',
    haveAccount:    '¿Ya tienes una cuenta?',
    signIn:         'Iniciar sesión',
    continueGuest:  '← Continuar sin cuenta',
    termsNote:      'Al registrarte aceptas nuestros',
    terms:          'Términos de Servicio',
    and:            'y la',
    privacy:        'Política de Privacidad',
    referralBanner: {
      title: '¡Fuiste invitado!',
      body1: 'Código de referido',
      body2: 'aplicado. Regístrate y tu amigo gana un mes gratis de Pro.',
    },
    errors: {
      noName:   'Por favor ingresa tu nombre.',
      pwReqs:   'Por favor cumple todos los requisitos de contraseña.',
      fallback: 'Error al registrar.',
    },
  },

  upgrade: {
    title:         'Elige tu plan',
    sub:           'Cancela cuando quieras. Sin cargos ocultos.',
    monthly:       'Mensual',
    annual:        'Anual',
    saveBadge:     'AHORRA 2 MES',
    mostPopular:   'Más Popular',
    proFor:        'Para individuos y parejas',
    houseAndBiz:   'Hogar y Negocios',
    fleetFor:      'Vehículos ilimitados · hogar o negocio',
    upgradeBtn:    'Mejorar a',
    signInToUp:    'Inicia sesión para mejorar',
    redirecting:   'Redirigiendo…',
    enterprise:    '¿Necesitas 50+ vehículos?',
    contactUs:     'Contáctanos para precios Empresariales',
    freeForever:   '$0 / para siempre',
    safeguardTitle:'🔒 Límites de plan aplicados automáticamente',
    safeguardBody: 'Las cuentas gratuitas tienen límite de 1 vehículo. Las cuentas Pro tienen límite de 3 vehículos — perfecto para individuos y parejas. Cuando alcances tu límite, se te pedirá que mejores — sin sorpresas. Fleet está diseñado para hogares y empresas que necesitan más de 3 vehículos.',
    backLink:      '← Volver a la calculadora',
    help:          'Ayuda',
    terms:         'Términos',
    privacy:       'Privacidad',
  },

  footer: {
    tagline:  'Capacidad de Gas — Sabe antes de llegar.',
    poweredBy:'Desarrollado por VNetCard™',
    help:     'Ayuda y Soporte',
    terms:    'Términos de Servicio',
    privacy:  'Política de Privacidad',
  },
};

// ── Dictionary & helpers ──────────────────────────────────────────────────────

export const translations: Record<Locale, Translations> = { en, es };

/** Returns the translation object for a given locale. */
export function getTranslations(locale: Locale): Translations {
  return translations[locale];
}
