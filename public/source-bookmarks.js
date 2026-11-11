const supported=new Set(['indeed','rozee','mustakbil','bayt','njp','linkedin','himalayas','jobicy','remoteok','wwr','remotive','wordpress']);
export function savedSourceIds(value){return Array.isArray(value)?[...new Set(value.filter(id=>supported.has(id)))]:[];}
export function toggleSavedSource(value,id){if(!supported.has(id))throw new RangeError('Unknown job source');const current=savedSourceIds(value);return current.includes(id)?current.filter(saved=>saved!==id):[...current,id];}
