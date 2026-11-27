// Datos de conexión a Supabase (Project Settings → API).
//
// Si se dejan vacíos, la app funciona en "modo local": guarda todo en este
// navegador, sin cuentas. Con los dos valores completos, pide ingresar con
// email y guarda los datos en la nube.
//
// La clave "anon" es pública por diseño: la protección real está en las reglas
// de la base (cada usuario solo ve lo suyo). NUNCA pegues acá la clave
// "service_role".
window.TURNOS_CONFIG = {
  supabaseUrl: "https://qdszzbuoqoltkcucskji.supabase.co/rest/v1/",
  supabaseAnonKey: "sb_publishable_zWGC41USzL0NLbriEuP1Uw_kPSSOMVc",
};
