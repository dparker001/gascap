/**
 * Pro Lifetime + complimentary getaway promo.
 *
 * Anyone who buys Pro Lifetime ($19.99) while this promo is ACTIVE receives a
 * complimentary resort getaway certificate (fulfilled via Marketing Boost). The
 * getaway is the entire incentive — there is NO discount; Lifetime stays at full
 * price ($19.99). This keeps price integrity intact while the getaway dwarfs any
 * coupon as a reason to buy.
 *
 * Fulfillment is fully automated via the Marketing Boost API (lib/marketingBoost.ts,
 * app/api/getaway/choose) — no manual admin step for any destination below.
 * A manual fallback (admin issues in the MB portal by hand) only fires if the
 * API call itself fails for some reason.
 *
 * ── GOING LIVE ────────────────────────────────────────────────────────────────
 * 1. Set GETAWAY_ACTIVE = true below (and optionally GETAWAY_END_DATE for urgency).
 * 2. Commit + deploy. That single flag:
 *      • shows the getaway banner + Lifetime-card badges,
 *      • turns on the auto-send-via-MB-API flow,
 *      • AND auto-pauses the standalone 50%-off new-member discount
 *        (NewMemberOfferBanner hides itself while this is active),
 *    so the getaway becomes the one Lifetime offer.
 *
 * Unlimited certificates can be issued (no supply cap), so the promo is
 * time-boxed for urgency, not quantity-capped.
 */

// ── Set GETAWAY_ACTIVE=false in Railway env to kill the promo without a redeploy ─
const GETAWAY_ACTIVE = process.env.GETAWAY_ACTIVE !== 'false';

// Optional hard deadline (ISO date) for urgency — null = no deadline / standing.
// Standing offer (no expiry) per Don — the getaway is always on with Lifetime.
// (Set an ISO date here anytime to create a countdown for a specific push.)
const GETAWAY_END_DATE: string | null = null;

/**
 * Honest disclosure facts (sourced from the Marketing Boost / RedeemVacations
 * redemption flow). Surfaced in the banner fine print and the buyer email so the
 * offer never feels like bait-and-switch. Deliberately does NOT quote a specific
 * nightly-fee number — it varies per destination and is shown to the traveler by
 * Marketing Boost at activation time, not by GasCap.
 */
export const GETAWAY_DISCLOSURE = {
  short: 'Hotel stay only — flights not included. Room rate is complimentary (no timeshare); you cover the nightly taxes & fees (vary by destination, shown when you activate) plus your own travel. Must be 21+, live 100+ miles from your destination, and book 30+ days ahead. Full terms at RedeemVacations.com.',
  full: [
    'No timeshare presentation and no hoops — activate online by prepaying your destination\'s hotel taxes & fees, then choose your resort and travel dates.',
    'This is a hotel stay only — flights/airfare are NOT included. The hotel room rate is free (valued up to $350/night); you cover the nightly taxes & fees (vary by destination — shown when you activate), plus your own airfare, food, and any resort fees the hotel may charge at check-in.',
    'Activate within 7 days of receiving it; travel any time within 18 months. Book at least 30 days ahead — excludes major holidays; weekends may add a small surcharge.',
    'For up to 2 adults (at least one age 21+); some hotels allow up to 2 children under 12. No group travel — one stay per household.',
    'You must live at least 100 miles from your chosen destination, and present a major credit/debit card + government ID at check-in.',
    'Activation fees are non-refundable and the certificate is non-transferable. One incentive per household every 12 months.',
    'Fulfilled by our travel partner — you\'ll receive your certificate from Marketing Boost / RedeemVacations. Full terms at RedeemVacations.com.',
  ],
} as const;

/**
 * The full getaway destination catalog, sourced directly from Marketing Boost
 * support (2026-07-27) — every mbDestinationId here is from MB's own list of
 * what this account can send, not the smaller/misleading account-scoped GET
 * /all-destination-list endpoint (confirmed to only surface a curated subset).
 * A representative sample across regions (US + Latin America + Asia + Middle
 * East) was spot-verified with real test sends against MB's live API; all
 * succeeded, so the rest of this MB-provided list is trusted without
 * individually re-testing all 100+ (that would mean spamming MB's system with
 * test sends for no real benefit).
 *
 * No per-destination dollar fee is stored or displayed — that amount varies by
 * destination and Marketing Boost shows it to the traveler at activation, not
 * GasCap at selection time. See GETAWAY_DISCLOSURE for the honest general terms.
 */
export interface GetawayDestination {
  id:              string;   // stable slug used in the choose API + emails
  name:            string;   // display name (city, or city + state/country when needed for clarity)
  country:         string;   // country name (English) — shown as the picker subtitle
  countryEs:       string;   // country name (Spanish)
  emoji:           string;
  mbDestinationId: string;   // Marketing Boost's own destination ID
}

const US = 'United States', US_ES = 'Estados Unidos';

export const GETAWAY_DESTINATIONS: readonly GetawayDestination[] = [
  // United States (alphabetical by city)
  { id: 'albuquerque',      name: 'Albuquerque, NM',        country: US, countryEs: US_ES, emoji: '🎈', mbDestinationId: '4230' },
  { id: 'atlanta',          name: 'Atlanta, GA',             country: US, countryEs: US_ES, emoji: '🍑', mbDestinationId: '35'   },
  { id: 'atlantic-city',    name: 'Atlantic City, NJ',       country: US, countryEs: US_ES, emoji: '🎰', mbDestinationId: '42'   },
  { id: 'boston',           name: 'Boston, MA',              country: US, countryEs: US_ES, emoji: '🦞', mbDestinationId: '4383' },
  { id: 'branson',          name: 'Branson, MO',             country: US, countryEs: US_ES, emoji: '🎶', mbDestinationId: '40'   },
  { id: 'cape-cod',         name: 'Cape Cod, MA',            country: US, countryEs: US_ES, emoji: '⚓', mbDestinationId: '4487' },
  { id: 'charleston',       name: 'Charleston, SC',          country: US, countryEs: US_ES, emoji: '🏛️', mbDestinationId: '4518' },
  { id: 'chicago',          name: 'Chicago, IL',             country: US, countryEs: US_ES, emoji: '🌆', mbDestinationId: '37'   },
  { id: 'colorado-springs', name: 'Colorado Springs, CO',    country: US, countryEs: US_ES, emoji: '⛰️', mbDestinationId: '4548' },
  { id: 'daytona-beach',    name: 'Daytona Beach, FL',       country: US, countryEs: US_ES, emoji: '🏁', mbDestinationId: '33'   },
  { id: 'denver',           name: 'Denver, CO',              country: US, countryEs: US_ES, emoji: '🏔️', mbDestinationId: '4834' },
  { id: 'estes-park',       name: 'Estes Park, CO',          country: US, countryEs: US_ES, emoji: '🦌', mbDestinationId: '21462' },
  { id: 'fort-lauderdale',  name: 'Fort Lauderdale, FL',     country: US, countryEs: US_ES, emoji: '🛥️', mbDestinationId: '5105' },
  { id: 'galveston',        name: 'Galveston, TX',           country: US, countryEs: US_ES, emoji: '🏖️', mbDestinationId: '5126' },
  { id: 'gatlinburg',       name: 'Gatlinburg, TN',          country: US, countryEs: US_ES, emoji: '🌲', mbDestinationId: '44'   },
  { id: 'grand-canyon',     name: 'Grand Canyon National Park, AZ', country: US, countryEs: US_ES, emoji: '🏜️', mbDestinationId: '5464' },
  { id: 'gulf-shores',      name: 'Gulf Shores, AL',         country: US, countryEs: US_ES, emoji: '🐚', mbDestinationId: '5484' },
  { id: 'hawaii',           name: 'Hawaii',                  country: US, countryEs: US_ES, emoji: '🌺', mbDestinationId: '36'   },
  { id: 'hot-springs',      name: 'Hot Springs, AR',         country: US, countryEs: US_ES, emoji: '♨️', mbDestinationId: '5534' },
  { id: 'lake-tahoe',       name: 'Lake Tahoe, CA/NV',       country: US, countryEs: US_ES, emoji: '🏞️', mbDestinationId: '5683' },
  { id: 'las-vegas',        name: 'Las Vegas, NV',           country: US, countryEs: US_ES, emoji: '🎰', mbDestinationId: '41'   },
  { id: 'los-angeles',      name: 'Los Angeles, CA',         country: US, countryEs: US_ES, emoji: '🌴', mbDestinationId: '5824' },
  { id: 'miami',            name: 'Miami, FL',               country: US, countryEs: US_ES, emoji: '🏖️', mbDestinationId: '30'   },
  { id: 'myrtle-beach',     name: 'Myrtle Beach, SC',        country: US, countryEs: US_ES, emoji: '🏖️', mbDestinationId: '43'   },
  { id: 'napa-valley',      name: 'Napa Valley, CA',         country: US, countryEs: US_ES, emoji: '🍷', mbDestinationId: '19630' },
  { id: 'new-orleans',      name: 'New Orleans, LA',         country: US, countryEs: US_ES, emoji: '🎷', mbDestinationId: '39'   },
  { id: 'new-york-city',    name: 'New York City, NY',       country: US, countryEs: US_ES, emoji: '🗽', mbDestinationId: '5306' },
  { id: 'ocean-city',       name: 'Ocean City, MD',          country: US, countryEs: US_ES, emoji: '🏖️', mbDestinationId: '5257' },
  { id: 'orlando',          name: 'Orlando, FL',             country: US, countryEs: US_ES, emoji: '🎢', mbDestinationId: '34'   },
  { id: 'palm-springs',     name: 'Palm Springs, CA',        country: US, countryEs: US_ES, emoji: '🌵', mbDestinationId: '5242' },
  { id: 'panama-city',      name: 'Panama City, FL',         country: US, countryEs: US_ES, emoji: '🏖️', mbDestinationId: '21103' },
  { id: 'phoenix',          name: 'Phoenix, AZ',             country: US, countryEs: US_ES, emoji: '🌵', mbDestinationId: '31'   },
  { id: 'san-antonio',      name: 'San Antonio, TX',         country: US, countryEs: US_ES, emoji: '🌵', mbDestinationId: '45'   },
  { id: 'san-diego',        name: 'San Diego, CA',           country: US, countryEs: US_ES, emoji: '🌊', mbDestinationId: '32'   },
  { id: 'san-francisco',    name: 'San Francisco, CA',       country: US, countryEs: US_ES, emoji: '🌉', mbDestinationId: '19441' },
  { id: 'savannah',         name: 'Savannah, GA',            country: US, countryEs: US_ES, emoji: '🌳', mbDestinationId: '5094' },
  { id: 'sedona',           name: 'Sedona, AZ',              country: US, countryEs: US_ES, emoji: '🏜️', mbDestinationId: '20898' },
  { id: 'st-petersburg',    name: 'St. Petersburg, FL',      country: US, countryEs: US_ES, emoji: '🏖️', mbDestinationId: '20904' },
  { id: 'nashville',        name: 'Nashville, TN',           country: US, countryEs: US_ES, emoji: '🎸', mbDestinationId: '5355' },
  { id: 'nashville-vw',     name: 'Virginia Beach, VA',      country: US, countryEs: US_ES, emoji: '🏖️', mbDestinationId: '4781' },

  // Mexico
  { id: 'cancun',          name: 'Cancún',                   country: 'Mexico', countryEs: 'México', emoji: '🏝️', mbDestinationId: '10'   },
  { id: 'cancun-riviera',  name: 'Cancún Riviera Maya',       country: 'Mexico', countryEs: 'México', emoji: '🏝️', mbDestinationId: '18370' },
  { id: 'puerto-vallarta', name: 'Puerto Vallarta',          country: 'Mexico', countryEs: 'México', emoji: '⛵', mbDestinationId: '48'   },
  { id: 'cabo-san-lucas',  name: 'Cabo San Lucas',           country: 'Mexico', countryEs: 'México', emoji: '🌵', mbDestinationId: '17756' },

  // Caribbean / Central America
  { id: 'punta-cana',      name: 'Punta Cana',               country: 'Dominican Republic', countryEs: 'República Dominicana', emoji: '🏝️', mbDestinationId: '2' },
  { id: 'puerto-plata',    name: 'Puerto Plata',             country: 'Dominican Republic', countryEs: 'República Dominicana', emoji: '🏝️', mbDestinationId: '19412' },
  { id: 'san-juan',        name: 'San Juan',                 country: 'Puerto Rico', countryEs: 'Puerto Rico', emoji: '🏝️', mbDestinationId: '20838' },

  // South America
  { id: 'buenos-aires',    name: 'Buenos Aires',             country: 'Argentina', countryEs: 'Argentina', emoji: '💃', mbDestinationId: '18' },
  { id: 'rio-de-janeiro',  name: 'Rio de Janeiro',           country: 'Brazil', countryEs: 'Brasil', emoji: '🏖️', mbDestinationId: '23' },
  { id: 'medellin',        name: 'Medellín',                 country: 'Colombia', countryEs: 'Colombia', emoji: '🌸', mbDestinationId: '24' },
  { id: 'cartagena',       name: 'Cartagena',                country: 'Colombia', countryEs: 'Colombia', emoji: '🏰', mbDestinationId: '25' },

  // Canada
  { id: 'toronto',         name: 'Toronto',                  country: 'Canada', countryEs: 'Canadá', emoji: '🍁', mbDestinationId: '26'   },
  { id: 'calgary',         name: 'Calgary',                  country: 'Canada', countryEs: 'Canadá', emoji: '🍁', mbDestinationId: '1863' },
  { id: 'edmonton',        name: 'Edmonton',                 country: 'Canada', countryEs: 'Canadá', emoji: '🍁', mbDestinationId: '1874' },
  { id: 'halifax',         name: 'Halifax',                  country: 'Canada', countryEs: 'Canadá', emoji: '🍁', mbDestinationId: '1887' },
  { id: 'montreal',        name: 'Montreal',                 country: 'Canada', countryEs: 'Canadá', emoji: '🍁', mbDestinationId: '1902' },
  { id: 'niagara-falls',   name: 'Niagara Falls',            country: 'Canada', countryEs: 'Canadá', emoji: '💦', mbDestinationId: '1951' },
  { id: 'ottawa',          name: 'Ottawa',                   country: 'Canada', countryEs: 'Canadá', emoji: '🍁', mbDestinationId: '1967' },
  { id: 'revelstoke',      name: 'Revelstoke',               country: 'Canada', countryEs: 'Canadá', emoji: '🏔️', mbDestinationId: '1989' },
  { id: 'vancouver',       name: 'Vancouver',                country: 'Canada', countryEs: 'Canadá', emoji: '🍁', mbDestinationId: '1990' },
  { id: 'winnipeg',        name: 'Winnipeg',                 country: 'Canada', countryEs: 'Canadá', emoji: '🍁', mbDestinationId: '2029' },
  { id: 'victoria',        name: 'Victoria',                 country: 'Canada', countryEs: 'Canadá', emoji: '🍁', mbDestinationId: '2107' },
  { id: 'quebec',          name: 'Quebec',                   country: 'Canada', countryEs: 'Canadá', emoji: '🍁', mbDestinationId: '2108' },

  // Europe
  { id: 'vienna',          name: 'Vienna',                   country: 'Austria', countryEs: 'Austria', emoji: '🎻', mbDestinationId: '7'    },
  { id: 'brussels',        name: 'Brussels',                 country: 'Belgium', countryEs: 'Bélgica', emoji: '🧇', mbDestinationId: '4423' },
  { id: 'dubrovnik',       name: 'Dubrovnik',                country: 'Croatia', countryEs: 'Croacia', emoji: '🏰', mbDestinationId: '4971' },
  { id: 'copenhagen',      name: 'Copenhagen',               country: 'Denmark', countryEs: 'Dinamarca', emoji: '🧜', mbDestinationId: '4562' },
  { id: 'paris',           name: 'Paris',                    country: 'France', countryEs: 'Francia', emoji: '🗼', mbDestinationId: '16'   },
  { id: 'cannes',          name: 'Cannes',                   country: 'France', countryEs: 'Francia', emoji: '🎬', mbDestinationId: '4447' },
  { id: 'berlin',          name: 'Berlin',                   country: 'Germany', countryEs: 'Alemania', emoji: '🏛️', mbDestinationId: '4274' },
  { id: 'munich',          name: 'Munich',                   country: 'Germany', countryEs: 'Alemania', emoji: '🍺', mbDestinationId: '5412' },
  { id: 'athens',          name: 'Athens',                   country: 'Greece', countryEs: 'Grecia', emoji: '🏛️', mbDestinationId: '19'   },
  { id: 'crete',           name: 'Crete',                    country: 'Greece', countryEs: 'Grecia', emoji: '🏛️', mbDestinationId: '4707' },
  { id: 'santorini',       name: 'Santorini',                country: 'Greece', countryEs: 'Grecia', emoji: '🏛️', mbDestinationId: '5128' },
  { id: 'budapest',        name: 'Budapest',                 country: 'Hungary', countryEs: 'Hungría', emoji: '🏛️', mbDestinationId: '61'   },
  { id: 'reykjavik',       name: 'Reykjavik',                country: 'Iceland', countryEs: 'Islandia', emoji: '❄️', mbDestinationId: '19633' },
  { id: 'dublin',          name: 'Dublin',                   country: 'Ireland', countryEs: 'Irlanda', emoji: '🍀', mbDestinationId: '4889' },
  { id: 'venice',          name: 'Venice',                   country: 'Italy', countryEs: 'Italia', emoji: '🚤', mbDestinationId: '28'   },
  { id: 'rome',            name: 'Rome',                     country: 'Italy', countryEs: 'Italia', emoji: '🏛️', mbDestinationId: '29'   },
  { id: 'florence',        name: 'Florence',                 country: 'Italy', countryEs: 'Italia', emoji: '🎨', mbDestinationId: '5071' },
  { id: 'naples',          name: 'Naples',                   country: 'Italy', countryEs: 'Italia', emoji: '🍕', mbDestinationId: '5376' },
  { id: 'milan',           name: 'Milan',                    country: 'Italy', countryEs: 'Italia', emoji: '👗', mbDestinationId: '5640' },
  { id: 'amsterdam',       name: 'Amsterdam',                country: 'Netherlands', countryEs: 'Países Bajos', emoji: '🚲', mbDestinationId: '4251' },
  { id: 'lisbon',          name: 'Lisbon',                   country: 'Portugal', countryEs: 'Portugal', emoji: '🚋', mbDestinationId: '5706' },
  { id: 'barcelona',       name: 'Barcelona',                country: 'Spain', countryEs: 'España', emoji: '🏛️', mbDestinationId: '27'   },
  { id: 'tenerife',        name: 'Tenerife',                 country: 'Spain', countryEs: 'España', emoji: '🏝️', mbDestinationId: '63'   },
  { id: 'benidorm',        name: 'Benidorm',                 country: 'Spain', countryEs: 'España', emoji: '🏖️', mbDestinationId: '4271' },
  { id: 'madrid',          name: 'Madrid',                   country: 'Spain', countryEs: 'España', emoji: '🏛️', mbDestinationId: '5922' },
  { id: 'majorca',         name: 'Majorca',                  country: 'Spain', countryEs: 'España', emoji: '🏝️', mbDestinationId: '6008' },
  { id: 'stockholm',       name: 'Stockholm',                country: 'Sweden', countryEs: 'Suecia', emoji: '🏛️', mbDestinationId: '5'    },
  { id: 'edinburgh',       name: 'Edinburgh',                country: 'United Kingdom', countryEs: 'Reino Unido', emoji: '🏰', mbDestinationId: '5028' },
  { id: 'glasgow',         name: 'Glasgow',                  country: 'United Kingdom', countryEs: 'Reino Unido', emoji: '🏛️', mbDestinationId: '5182' },
  { id: 'london',          name: 'London',                   country: 'United Kingdom', countryEs: 'Reino Unido', emoji: '🎡', mbDestinationId: '5727' },

  // Asia / Middle East / Africa / Oceania
  { id: 'beijing',         name: 'Beijing',                  country: 'China', countryEs: 'China', emoji: '🏯', mbDestinationId: '19653' },
  { id: 'goa',             name: 'Goa',                      country: 'India', countryEs: 'India', emoji: '🏖️', mbDestinationId: '65'   },
  { id: 'bali',            name: 'Bali',                     country: 'Indonesia', countryEs: 'Indonesia', emoji: '🌴', mbDestinationId: '49'   },
  { id: 'jerusalem',       name: 'Jerusalem',                country: 'Israel', countryEs: 'Israel', emoji: '🕊️', mbDestinationId: '46'   },
  { id: 'kyoto',           name: 'Kyoto',                    country: 'Japan', countryEs: 'Japón', emoji: '⛩️', mbDestinationId: '5638' },
  { id: 'macau',           name: 'Macau',                    country: 'Macau', countryEs: 'Macao', emoji: '🎰', mbDestinationId: '5920' },
  { id: 'kuala-lumpur',    name: 'Kuala Lumpur',             country: 'Malaysia', countryEs: 'Malasia', emoji: '🏙️', mbDestinationId: '5616' },
  { id: 'maldives',        name: 'Maldives',                 country: 'Maldives', countryEs: 'Maldivas', emoji: '🏝️', mbDestinationId: '19439' },
  { id: 'christchurch',    name: 'Christchurch',             country: 'New Zealand', countryEs: 'Nueva Zelanda', emoji: '🥝', mbDestinationId: '15'    },
  { id: 'auckland',        name: 'Auckland',                 country: 'New Zealand', countryEs: 'Nueva Zelanda', emoji: '🥝', mbDestinationId: '16039' },
  { id: 'bay-of-plenty',   name: 'Bay of Plenty and Rotorua', country: 'New Zealand', countryEs: 'Nueva Zelanda', emoji: '🥝', mbDestinationId: '16083' },
  { id: 'wellington',      name: 'Wellington',               country: 'New Zealand', countryEs: 'Nueva Zelanda', emoji: '🥝', mbDestinationId: '16089' },
  { id: 'dunedin',         name: 'Dunedin',                  country: 'New Zealand', countryEs: 'Nueva Zelanda', emoji: '🥝', mbDestinationId: '16103' },
  { id: 'marlborough',     name: 'Marlborough',              country: 'New Zealand', countryEs: 'Nueva Zelanda', emoji: '🍷', mbDestinationId: '16104' },
  { id: 'boracay',         name: 'Boracay',                  country: 'Philippines', countryEs: 'Filipinas', emoji: '🏝️', mbDestinationId: '6'    },
  { id: 'bohol',           name: 'Bohol',                    country: 'Philippines', countryEs: 'Filipinas', emoji: '🏝️', mbDestinationId: '4354' },
  { id: 'mecca',           name: 'Mecca',                    country: 'Saudi Arabia', countryEs: 'Arabia Saudita', emoji: '🕋', mbDestinationId: '5681' },
  { id: 'singapore',       name: 'Singapore',                country: 'Singapore', countryEs: 'Singapur', emoji: '🦁', mbDestinationId: '4936' },
  { id: 'cape-town',       name: 'Cape Town',                country: 'South Africa', countryEs: 'Sudáfrica', emoji: '🏔️', mbDestinationId: '17'   },
  { id: 'seoul',           name: 'Seoul',                    country: 'South Korea', countryEs: 'Corea del Sur', emoji: '🏙️', mbDestinationId: '5006' },
  { id: 'zanzibar',        name: 'Zanzibar',                 country: 'Tanzania', countryEs: 'Tanzania', emoji: '🏝️', mbDestinationId: '19631' },
  { id: 'bangkok',         name: 'Bangkok',                  country: 'Thailand', countryEs: 'Tailandia', emoji: '🛕', mbDestinationId: '1'    },
  { id: 'phuket',          name: 'Phuket',                   country: 'Thailand', countryEs: 'Tailandia', emoji: '🏖️', mbDestinationId: '3'    },
  { id: 'koh-samui',       name: 'Koh Samui',                country: 'Thailand', countryEs: 'Tailandia', emoji: '🏝️', mbDestinationId: '50'   },
  { id: 'pattaya',         name: 'Pattaya',                  country: 'Thailand', countryEs: 'Tailandia', emoji: '🏖️', mbDestinationId: '5221' },
  { id: 'istanbul',        name: 'Istanbul',                 country: 'Turkey', countryEs: 'Turquía', emoji: '🕌', mbDestinationId: '21'   },
  { id: 'bodrum',          name: 'Bodrum',                   country: 'Turkey', countryEs: 'Turquía', emoji: '🏖️', mbDestinationId: '22'   },
  { id: 'antalya',         name: 'Antalya',                  country: 'Turkey', countryEs: 'Turquía', emoji: '🏖️', mbDestinationId: '4254' },
  { id: 'dubai',           name: 'Dubai',                    country: 'United Arab Emirates', countryEs: 'Emiratos Árabes Unidos', emoji: '🌆', mbDestinationId: '20' },
  { id: 'fiji',            name: 'Fiji',                     country: 'Fiji', countryEs: 'Fiyi', emoji: '🏝️', mbDestinationId: '166'  },
  { id: 'vanuatu',         name: 'Vanuatu',                  country: 'Vanuatu', countryEs: 'Vanuatu', emoji: '🏝️', mbDestinationId: '167'  },
] as const;

/** Look up a destination by its id. */
export function findGetawayDestination(id: string | null | undefined): GetawayDestination | undefined {
  if (!id) return undefined;
  return GETAWAY_DESTINATIONS.find((d) => d.id === id);
}

export interface GetawayOfferStatus {
  /** Promo is globally active (flag on + within any deadline) */
  active:   boolean;
  /** This specific user can claim it (active + not already Lifetime) */
  eligible: boolean;
  /** Whole days until the deadline; null when there's no deadline */
  daysLeft: number | null;
}

/** Is the getaway promo globally live right now? */
export function getawayPromoActive(): boolean {
  if (!GETAWAY_ACTIVE) return false;
  if (GETAWAY_END_DATE) {
    const end = new Date(GETAWAY_END_DATE).getTime();
    if (!Number.isNaN(end) && Date.now() > end) return false;
  }
  return true;
}

/** Whole days remaining until the deadline, or null if there's no deadline. */
export function getawayDaysLeft(): number | null {
  if (!GETAWAY_END_DATE) return null;
  const end = new Date(GETAWAY_END_DATE).getTime();
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.ceil((end - Date.now()) / 86_400_000));
}

/**
 * Per-user eligibility. Anyone who isn't already on Lifetime can claim the
 * getaway by buying Lifetime while the promo is active. `stripeInterval` is the
 * billing interval from the user record.
 */
export function getawayOfferStatus(user: {
  stripeInterval?: string | null;
}): GetawayOfferStatus {
  const active = getawayPromoActive();
  const alreadyLifetime = user.stripeInterval === 'lifetime';
  return {
    active,
    eligible: active && !alreadyLifetime,
    daysLeft: getawayDaysLeft(),
  };
}
