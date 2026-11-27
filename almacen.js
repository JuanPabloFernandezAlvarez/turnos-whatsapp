"use strict";

// =====================================================================
// ALMACÉN: la única parte de la app que sabe DÓNDE se guardan los datos.
//
//  * Modo local  → localStorage del navegador (como antes). Se usa si
//                  config.js no tiene los datos de Supabase.
//  * Modo nube   → cuenta con email + base PostgreSQL en Supabase.
//
// app.js solo habla con el objeto global `Almacen`; no sabe nada de
// tablas, ni de Supabase. Cuando se reescriba el frontend, esta es la
// única pieza que hay que reemplazar.
//
// Forma de los datos que entrega y recibe (la misma que usa app.js):
//   { turnos, negocio, plantilla, horario, servicios, porcentaje, cortes }
//
// En modo nube no se envía todo cada vez: se compara contra lo último
// guardado y se suben solo las filas que cambiaron.
// =====================================================================

function nuevoUuid() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  const b = window.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---------------------------------------------------------------------
// MODO LOCAL
// ---------------------------------------------------------------------
function crearAlmacenLocal() {
  const CLAVE = "turnos_v1";

  const almacen = {
    modo: "local",
    // app.js reemplaza estos avisos
    alError: () => {},
    alEstado: () => {},
    alCambioExterno: () => {},
    alSalir: () => {},

    async iniciar() {
      return { necesitaLogin: false };
    },

    async cargar() {
      let guardado = null;
      try {
        guardado = localStorage.getItem(CLAVE);
      } catch (error) {
        console.error("No se pudo leer lo guardado", error);
      }
      if (!guardado) return null;

      try {
        return JSON.parse(guardado);
      } catch (error) {
        console.error("Los datos guardados están dañados", error);
        // Se deja una copia para poder recuperarlos antes de que se pisen
        try {
          localStorage.setItem(CLAVE + "_respaldo", guardado);
        } catch {
          /* sin espacio: no hay nada más que hacer */
        }
        return null;
      }
    },

    guardar(datos) {
      try {
        localStorage.setItem(CLAVE, JSON.stringify(datos));
      } catch (error) {
        console.error("No se pudo guardar", error);
        almacen.alError({
          mensaje: "No se pudo guardar. Revisá el espacio del navegador.",
        });
      }
    },

    hayPendientes: () => false,
    esperar: () => Promise.resolve(),
    reintentar: () => {},
    usuario: () => null,
  };

  // Cambios hechos desde otra pestaña
  window.addEventListener("storage", (evento) => {
    if (evento.key !== CLAVE || !evento.newValue) return;
    try {
      const crudo = JSON.parse(evento.newValue);
      if (!crudo || !Array.isArray(crudo.turnos)) {
        throw new Error("Los datos guardados no contienen una lista de turnos");
      }
      almacen.alCambioExterno(crudo);
    } catch (error) {
      console.error("No se pudo sincronizar los turnos de otra pestaña", error);
    }
  });

  return almacen;
}

// ---------------------------------------------------------------------
// MODO NUBE
// `nube` es el acceso crudo a la base (ver crearNubeSupabase). Está
// separado para poder probar toda la lógica contra un Postgres de prueba.
// ---------------------------------------------------------------------
function crearAlmacenNube(nube, { tamPagina = 1000, reintentoMs = 15000 } = {}) {
  const TROZO = 200;
  const pad = (n) => String(n).padStart(2, "0");

  // ---- Estado interno -------------------------------------------------
  let negocio = null; // fila de la tabla negocio
  let sesion = null; // { id, email, nombreNegocio }
  let ultimo = null; // filas ya guardadas en la nube, para saber qué cambió
  let turnosEnNube = new Set(); // ids de turnos que existen en la base
  let duraciones = new Map(); // turno.id -> duración con la que se guardó
  let clientesPorId = new Map(); // id -> { nombre, telefono, persistido }
  let clientesPorClave = new Map(); // "nombre|telefono" -> id
  let clienteDeTurno = new Map(); // turno.id -> cliente.id

  let datosRef = null;
  let pendiente = false;
  let sincronizando = false;
  let rehacer = false;
  let trabajo = Promise.resolve();
  let temporizador = null;

  // ---- Fechas: la app usa fecha + hora local; la base, un instante ----
  const aInstante = (fecha, hora) => new Date(`${fecha}T${hora}:00`).toISOString();

  function desdeInstante(iso) {
    const d = new Date(iso);
    return {
      fecha: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      hora: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    };
  }

  const claveCliente = (nombre, telefono) =>
    String(nombre || "").trim().toLowerCase() + "|" + String(telefono || "").replace(/\D/g, "");

  const trozos = (lista) => {
    const partes = [];
    for (let i = 0; i < lista.length; i += TROZO) partes.push(lista.slice(i, i + TROZO));
    return partes;
  };

  // ---- Lectura paginada (la API devuelve como máximo 1000 filas) ------
  async function leerTodo(tabla, opciones) {
    const filas = [];
    for (let desde = 0; ; desde += tamPagina) {
      const pagina = await nube.leerPagina(tabla, desde, desde + tamPagina - 1, opciones);
      filas.push(...pagina);
      if (pagina.length < tamPagina) break;
    }
    return filas;
  }

  // ---- Negocio: se crea la primera vez que alguien ingresa -----------
  async function asegurarNegocio() {
    let fila = await nube.leerNegocio();
    if (!fila) {
      const nombre = (sesion.nombreNegocio || "").trim().slice(0, 80) || "Mi barbería";
      fila = await nube.crearNegocio(sesion.id, nombre);
      // Horario inicial: todos los días de 09:00 a 20:00 (se puede ajustar luego)
      const horarios = [0, 1, 2, 3, 4, 5, 6].map((dia) => ({
        id: nuevoUuid(),
        negocio_id: fila.id,
        dia_semana: dia,
        desde: "09:00",
        hasta: "20:00",
      }));
      await nube.upsert("horario_atencion", horarios);
    }
    return fila;
  }

  // ---- Base de datos → forma que usa la app ---------------------------
  async function cargarDeNube() {
    negocio = await asegurarNegocio();

    const [horarios, clientes, servicios, turnos, cobros] = await Promise.all([
      leerTodo("horario_atencion", { activos: false }),
      leerTodo("cliente", { activos: true, orden: "creado_en" }),
      leerTodo("servicio", { activos: true, orden: "creado_en" }),
      leerTodo("turno", { activos: true, orden: "inicio" }),
      leerTodo("cobro", { activos: true, orden: "cobrado_en" }),
    ]);

    clientesPorId = new Map();
    clientesPorClave = new Map();
    clienteDeTurno = new Map();
    duraciones = new Map();
    for (const c of clientes) {
      clientesPorId.set(c.id, { nombre: c.nombre, telefono: c.telefono || "", persistido: true });
      const clave = claveCliente(c.nombre, c.telefono);
      if (!clientesPorClave.has(clave)) clientesPorClave.set(clave, c.id);
    }

    const cobrados = new Set(cobros.filter((c) => c.turno_id).map((c) => c.turno_id));
    turnosEnNube = new Set([...turnos.map((t) => t.id), ...cobrados]);

    const horas = horarios.map((h) => ({ desde: h.desde.slice(0, 5), hasta: h.hasta.slice(0, 5) }));
    const horario = {
      inicio: horas.length ? horas.map((h) => h.desde).sort()[0] : "09:00",
      fin: horas.length ? horas.map((h) => h.hasta).sort().reverse()[0] : "20:00",
      duracion: negocio.duracion_turno_min,
    };

    const datos = {
      negocio: negocio.nombre,
      plantilla: negocio.plantilla_recordatorio,
      porcentaje: negocio.porcentaje,
      horario,
      servicios: servicios.map((s) => ({ id: s.id, nombre: s.nombre, precio: s.precio })),
      turnos: turnos.map((t) => {
        const cliente = clientesPorId.get(t.cliente_id) || { nombre: "Sin nombre", telefono: "" };
        clienteDeTurno.set(t.id, t.cliente_id);
        duraciones.set(t.id, t.duracion_min);
        return {
          id: t.id,
          nombre: cliente.nombre,
          telefono: cliente.telefono,
          ...desdeInstante(t.inicio),
          estado: t.estado,
          cobrado: cobrados.has(t.id),
        };
      }),
      cortes: cobros.map((c) => ({
        id: c.id,
        ...desdeInstante(c.cobrado_en),
        nombre: c.cliente_nombre,
        servicio: c.servicio_nombre,
        precio: c.precio,
        porcentaje: c.porcentaje,
        ...(c.turno_id ? { turnoId: c.turno_id } : {}),
        ...(c.manual ? { manual: true } : {}),
      })),
    };

    ultimo = armarFilas(datos);
    return datos;
  }

  // ---- Forma que usa la app → filas de la base ------------------------
  function clienteParaTurno(turno) {
    const clave = claveCliente(turno.nombre, turno.telefono);
    const previo = clienteDeTurno.get(turno.id);
    if (previo) {
      const c = clientesPorId.get(previo);
      if (c && claveCliente(c.nombre, c.telefono) === clave) return previo;
    }
    let id = clientesPorClave.get(clave);
    if (!id) {
      id = nuevoUuid();
      clientesPorId.set(id, {
        nombre: String(turno.nombre || "").trim().slice(0, 80) || "Sin nombre",
        telefono: String(turno.telefono || "").trim(),
        persistido: false,
      });
      clientesPorClave.set(clave, id);
    }
    clienteDeTurno.set(turno.id, id);
    return id;
  }

  function armarFilas(datos) {
    const duracionActual = Number.isInteger(datos.horario && datos.horario.duracion)
      ? datos.horario.duracion
      : negocio.duracion_turno_min;
    const idsTurnos = new Set(datos.turnos.map((t) => t.id));

    const filas = { negocio: null, servicio: new Map(), turno: new Map(), cobro: new Map() };

    filas.negocio = {
      nombre: String(datos.negocio || "").trim().slice(0, 80) || negocio.nombre,
      porcentaje: datos.porcentaje > 0 ? Math.min(100, Math.round(datos.porcentaje)) : null,
      plantilla_recordatorio: String(datos.plantilla ?? ""),
      duracion_turno_min: duracionActual,
    };

    for (const s of datos.servicios) {
      filas.servicio.set(s.id, {
        id: s.id,
        negocio_id: negocio.id,
        nombre: String(s.nombre).slice(0, 60),
        precio: Math.max(1, Math.round(s.precio)),
      });
    }

    for (const t of datos.turnos) {
      filas.turno.set(t.id, {
        id: t.id,
        negocio_id: negocio.id,
        cliente_id: clienteParaTurno(t),
        inicio: aInstante(t.fecha, t.hora),
        duracion_min: duraciones.get(t.id) ?? duracionActual,
        estado: t.estado,
      });
    }

    for (const c of datos.cortes) {
      // Un cobro queda atado a su turno solo si ese turno existe en la base
      const conTurno =
        !c.manual && c.turnoId != null && (idsTurnos.has(c.turnoId) || turnosEnNube.has(c.turnoId));
      filas.cobro.set(c.id, {
        id: c.id,
        negocio_id: negocio.id,
        turno_id: conTurno ? c.turnoId : null,
        cliente_nombre: String(c.nombre || "").trim().slice(0, 80) || "Sin nombre",
        servicio_nombre: String(c.servicio || "Corte").slice(0, 60),
        precio: Math.max(1, Math.round(c.precio)),
        porcentaje: Math.min(100, Math.max(1, Math.round(c.porcentaje || datos.porcentaje || 1))),
        cobrado_en: aInstante(c.fecha, c.hora),
        manual: !conTurno,
      });
    }
    return filas;
  }

  function diferencias(antes, ahora) {
    const subir = [];
    const borrar = [];
    for (const [id, fila] of ahora) {
      const previa = antes.get(id);
      if (!previa || JSON.stringify(previa) !== JSON.stringify(fila)) subir.push(fila);
    }
    for (const id of antes.keys()) if (!ahora.has(id)) borrar.push(id);
    return { subir, borrar };
  }

  const subirEnTrozos = async (tabla, filas) => {
    for (const parte of trozos(filas)) await nube.upsert(tabla, parte);
  };
  const borrarEnTrozos = async (tabla, ids) => {
    for (const parte of trozos(ids)) await nube.borrarLogico(tabla, parte);
  };

  // ---- Un ciclo de guardado -------------------------------------------
  async function sincronizarUnaVez() {
    const actual = armarFilas(datosRef);
    const antes = ultimo;

    if (JSON.stringify(antes.negocio) !== JSON.stringify(actual.negocio)) {
      await nube.actualizarNegocio(negocio.id, actual.negocio);
      negocio = { ...negocio, ...actual.negocio };
    }

    // Clientes nuevos (los turnos los referencian)
    const nuevos = [...clientesPorId]
      .filter(([, c]) => !c.persistido)
      .map(([id, c]) => ({
        id,
        negocio_id: negocio.id,
        nombre: c.nombre,
        telefono: c.telefono || null,
      }));
    await subirEnTrozos("cliente", nuevos);
    nuevos.forEach((c) => {
      clientesPorId.get(c.id).persistido = true;
    });

    const servicios = diferencias(antes.servicio, actual.servicio);
    const turnos = diferencias(antes.turno, actual.turno);
    const cobros = diferencias(antes.cobro, actual.cobro);

    await subirEnTrozos("servicio", servicios.subir);

    // Primero lo que libera horarios (borrados y cancelaciones), después lo que ocupa
    await borrarEnTrozos("turno", turnos.borrar);
    const libera = (f) => f.estado === "cancelado" || f.estado === "ausente";
    await subirEnTrozos("turno", turnos.subir.filter(libera));
    await subirEnTrozos("turno", turnos.subir.filter((f) => !libera(f)));

    // Primero se anulan los cobros borrados (permite volver a cobrar un turno)
    await borrarEnTrozos("cobro", cobros.borrar);
    await subirEnTrozos("cobro", cobros.subir);

    await borrarEnTrozos("servicio", servicios.borrar);

    actual.turno.forEach((_, id) => turnosEnNube.add(id));
    ultimo = actual;
  }

  function mensajeDe(error) {
    if (error.sesion) return "Tu sesión venció. Ingresá de nuevo.";
    if (error.code === "23P01") return "Ese horario lo ocupa otro turno. Se actualizó la agenda.";
    if (error.code === "23505") return "Ese cambio ya existe (por ejemplo, un turno ya cobrado). Se actualizó la información.";
    return "No se pudo guardar el último cambio. Se actualizó la información.";
  }

  function ejecutar() {
    sincronizando = true;
    almacen.alEstado("guardando");
    trabajo = (async () => {
      try {
        do {
          rehacer = false;
          await sincronizarUnaVez();
        } while (rehacer);
        pendiente = false;
        almacen.alEstado("guardado");
      } catch (error) {
        if (error.transitorio) {
          // Sin conexión: el cambio queda pendiente y se reintenta solo
          almacen.alEstado("sin-conexion");
          clearTimeout(temporizador);
          temporizador = setTimeout(reintentar, reintentoMs);
        } else if (error.sesion) {
          // Sesión vencida: los cambios se conservan y se reenvían al volver a ingresar
          almacen.alEstado("sin-conexion");
          almacen.alError({ mensaje: mensajeDe(error), sesion: true });
        } else {
          console.error("Error al guardar", error);
          pendiente = false;
          almacen.alEstado("guardado");
          almacen.alError({ mensaje: mensajeDe(error), recargar: true });
        }
      } finally {
        sincronizando = false;
      }
    })();
    return trabajo;
  }

  function reintentar() {
    if (pendiente && !sincronizando && datosRef) ejecutar();
  }
  window.addEventListener("online", reintentar);

  // ---- Interfaz pública -----------------------------------------------
  const almacen = {
    modo: "nube",
    alError: () => {},
    alEstado: () => {},
    alCambioExterno: () => {},
    alSalir: () => {},

    async iniciar() {
      sesion = await nube.auth.sesion();
      nube.auth.alSalir(() => almacen.alSalir());
      return { necesitaLogin: !sesion };
    },

    async ingresar(email, clave) {
      await nube.auth.ingresar(email, clave);
      sesion = await nube.auth.sesion();
    },

    // Devuelve { necesitaConfirmar: true } si Supabase pide confirmar el email
    async registrar(email, clave, nombreNegocio) {
      const { sesionIniciada } = await nube.auth.registrar(email, clave, nombreNegocio);
      if (!sesionIniciada) return { necesitaConfirmar: true };
      sesion = await nube.auth.sesion();
      return { necesitaConfirmar: false };
    },

    async salir() {
      await nube.auth.salir();
    },

    usuario: () => (sesion ? sesion.email : null),

    cargar: cargarDeNube,

    guardar(datos) {
      datosRef = datos;
      pendiente = true;
      if (sincronizando) rehacer = true;
      else ejecutar();
    },

    hayPendientes: () => pendiente || sincronizando,
    esperar: () => trabajo,
    reintentar,
  };

  return almacen;
}

// ---------------------------------------------------------------------
// Acceso crudo a Supabase (lo más fino posible: sin reglas de negocio)
// ---------------------------------------------------------------------
function crearNubeSupabase(sb) {
  const fallo = (error, status) => {
    const e = new Error(error.message || "Sin conexión");
    e.code = error.code || "";
    e.status = status || 0;
    e.sesion = e.status === 401 || e.code === "PGRST301" || e.code === "PGRST303";
    // Sin conexión o error del servidor: vale la pena reintentar.
    // Un rechazo de la base (código de error) no se arregla reintentando.
    e.transitorio = !e.sesion && (!e.code || e.status >= 500);
    return e;
  };

  const traducirAuth = (error) => {
    const codigo = error.code || "";
    const texto = String(error.message || "");
    let mensaje = texto || "No se pudo completar la operación";
    if (codigo === "invalid_credentials" || /invalid login credentials/i.test(texto)) {
      mensaje = "Email o contraseña incorrectos";
    } else if (codigo === "email_not_confirmed" || /email not confirmed/i.test(texto)) {
      mensaje = "Primero confirmá tu email (te enviamos un mensaje)";
    } else if (codigo === "user_already_exists" || /already registered/i.test(texto)) {
      mensaje = "Ya existe una cuenta con ese email";
    } else if (codigo === "weak_password" || /at least \d+ characters/i.test(texto)) {
      mensaje = "La contraseña es muy débil (mínimo 6 caracteres)";
    } else if (/rate limit|too many/i.test(texto) || /rate_limit/.test(codigo)) {
      mensaje = "Demasiados intentos. Esperá un momento y probá de nuevo";
    } else if (/failed to fetch|network/i.test(texto)) {
      mensaje = "Sin conexión. Revisá tu internet";
    } else if (/invalid.*email|email.*invalid/i.test(texto)) {
      mensaje = "Revisá el email";
    }
    return new Error(mensaje);
  };

  const resultado = ({ data, error, status }) => {
    if (error) throw fallo(error, status);
    return data;
  };

  return {
    async leerPagina(tabla, desde, hasta, { activos = true, orden } = {}) {
      let consulta = sb.from(tabla).select("*");
      if (activos) consulta = consulta.is("eliminado_en", null);
      if (orden) consulta = consulta.order(orden, { ascending: true });
      // Desempate por id: sin esto, la paginación puede repetir o saltear filas
      consulta = consulta.order("id", { ascending: true }).range(desde, hasta);
      return resultado(await consulta);
    },

    async upsert(tabla, filas) {
      if (!filas.length) return;
      resultado(await sb.from(tabla).upsert(filas, { onConflict: "id" }));
    },

    async borrarLogico(tabla, ids) {
      if (!ids.length) return;
      resultado(
        await sb.from(tabla).update({ eliminado_en: new Date().toISOString() }).in("id", ids),
      );
    },

    async leerNegocio() {
      return resultado(await sb.from("negocio").select("*").maybeSingle());
    },

    async crearNegocio(ownerId, nombre) {
      return resultado(
        await sb.from("negocio").insert({ owner_id: ownerId, nombre }).select().single(),
      );
    },

    async actualizarNegocio(id, campos) {
      resultado(await sb.from("negocio").update(campos).eq("id", id));
    },

    auth: {
      async sesion() {
        const { data, error } = await sb.auth.getSession();
        if (error || !data.session) return null;
        const { user } = data.session;
        return {
          id: user.id,
          email: user.email,
          nombreNegocio: (user.user_metadata && user.user_metadata.negocio_nombre) || "",
        };
      },

      async ingresar(email, clave) {
        const { error } = await sb.auth.signInWithPassword({ email, password: clave });
        if (error) throw traducirAuth(error);
      },

      async registrar(email, clave, nombreNegocio) {
        const { data, error } = await sb.auth.signUp({
          email,
          password: clave,
          options: { data: { negocio_nombre: nombreNegocio } },
        });
        if (error) throw traducirAuth(error);
        return { sesionIniciada: Boolean(data.session) };
      },

      async salir() {
        await sb.auth.signOut();
      },

      alSalir(aviso) {
        sb.auth.onAuthStateChange((evento) => {
          if (evento === "SIGNED_OUT") aviso();
        });
      },
    },
  };
}

// ---------------------------------------------------------------------
// Elección automática de modo
// ---------------------------------------------------------------------
const Almacen = (() => {
  const config = window.TURNOS_CONFIG || {};
  if (config.supabaseUrl && config.supabaseAnonKey && window.supabase) {
    const cliente = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    return crearAlmacenNube(crearNubeSupabase(cliente));
  }
  return crearAlmacenLocal();
})();
