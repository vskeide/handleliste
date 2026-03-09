export type Locale = 'nn' | 'nb' | 'en';

const strings: Record<string, Record<string, string>> = {
  nn: {
    // Navigation
    'nav.lists': 'Lister',
    'nav.stores': 'Butikkar',
    'nav.settings': 'Innstillingar',

    // Welcome
    'welcome.title': 'Handleliste',
    'welcome.subtitle': 'Smart handleliste tilpassa dine butikkar i Volda',
    'welcome.create': 'Opprett ny husstand',
    'welcome.join': 'Bli med i husstand',
    'welcome.share_hint': 'Del koden med familien for å synkronisere handlelista i sanntid',

    // Auth
    'auth.household_name': 'Namn på husstand',
    'auth.set_pin': 'Vel ein PIN-kode (4-6 siffer)',
    'auth.confirm_pin': 'Stadfest PIN-kode',
    'auth.enter_code': 'Skriv inn husstandskode',
    'auth.enter_pin': 'Skriv inn PIN-kode',
    'auth.code_label': 'Din husstandskode',
    'auth.code_share': 'Del denne koden med familien din',

    // Lists
    'lists.title': 'Mine handlelister',
    'lists.active': 'Aktive lister',
    'lists.templates': 'Malar',
    'lists.new': 'Ny handleliste',
    'lists.items_count': '{count} varer',
    'lists.done': 'Ferdig',
    'lists.no_store': 'Ingen butikk vald',
    'lists.use_template': 'Bruk',
    'lists.used_times': 'Brukt {count} gonger',

    // List detail
    'list.add_item': 'Legg til vare',
    'list.search_placeholder': 'Søk eller skriv inn...',
    'list.create_new': 'Opprett "{name}"',
    'list.pick_section': 'Vel avdeling',
    'list.done_section': 'Handla',
    'list.switch_store': 'Byt',
    'list.show_map': 'Vis butikkart',
    'list.synced': 'Synkronisert',
    'list.new_badge': 'NY',
    'list.close': 'Lukk',
    'list.save_as_template': 'Lagre som mal',
    'list.delete_list': 'Slett liste',
    'list.rename': 'Endre namn',

    // Stores
    'stores.title': 'Mine butikkar',
    'stores.add': 'Legg til butikk',
    'stores.mapped': 'Kartlagd',
    'stores.not_mapped': 'Ikkje kartlagd',
    'stores.edit_order': 'Rediger rekkjefølgje',
    'stores.view_map': 'Vis kart',
    'stores.shared': 'Delt',
    'stores.already_mapped': 'Denne butikken er kartlagd av andre brukarar',
    'stores.use_default': 'Bruk standard rekkjefølgje',
    'stores.customize': 'Tilpass mi rekkjefølgje',

    // Mapping
    'mapping.title': 'Kartlegg rekkjefølgje',
    'mapping.instruction': 'Dra avdelingane i den rekkjefølgja du går gjennom butikken:',
    'mapping.save': 'Lagre rekkjefølgje',
    'mapping.shared_note': 'Denne rekkjefølgja vert delt med alle som brukar denne butikken',
    'mapping.custom_note': 'Denne rekkjefølgja gjeld berre for din husstand',
    'mapping.no_permission': 'Berre admin eller den som kartla butikken kan endre delt rekkjefølgje',

    // Store map
    'map.title': 'Butikkart',
    'map.view': 'Vis',
    'map.edit': 'Rediger',
    'map.entrance': 'INNGANG',
    'map.checkout': 'KASSAR',
    'map.route_hint': '= di rute gjennom butikken',
    'map.shared_label': 'Delt kart',
    'map.last_updated': 'Sist oppdatert',
    'map.save': 'Lagre kart',
    'map.no_permission': 'Berre admin eller den som kartla butikken kan endre kartet',

    // Settings
    'settings.title': 'Innstillingar',
    'settings.household_name': 'Namn på husstand',
    'settings.household_code': 'Husstandskode',
    'settings.family_size': 'Familiestorleik',
    'settings.change_pin': 'Endre PIN-kode',
    'settings.language': 'Språk',
    'settings.logout': 'Logg ut',

    // General
    'general.save': 'Lagre',
    'general.cancel': 'Avbryt',
    'general.delete': 'Slett',
    'general.edit': 'Rediger',
    'general.close': 'Lukk',
    'general.confirm': 'Stadfest',
    'general.today': 'i dag',
  },
};

export function t(key: string, locale: Locale = 'nn', params?: Record<string, string | number>): string {
  const localeStrings = strings[locale] || strings.nn;
  let str = localeStrings[key] || key;
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      str = str.replace(`{${k}}`, String(v));
    });
  }
  return str;
}
