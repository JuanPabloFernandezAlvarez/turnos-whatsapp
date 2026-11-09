// Datos y persistencia

const CLAVE_GUARDADO = "turnos_v1";
const ESTADOS_TURNO = ["pendiente", "confirmado", "cancelado", "ausente"];
const PATRON_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

let datos = {
  turnos: [],
  negocio: "",
  plantilla:
    "Hola {nombre}! Te recordamos tu turno {dia} a las {hora} en {negocio}. ¿Me confirmás? 🙌",
  horario: { inicio: "09:00", fin: "20:00", duracion: 30 },
  servicios: [],
  porcentaje: null,
  cortes: [],
};

// Si no es null, estamos editando ese turno en vez de crear uno nuevo
let editandoId = null;

const $ = (id) => document.getElementById(id);

function cargar() {
  try {
    const guardado = localStorage.getItem(CLAVE_GUARDADO);
    if (guardado) datos = { ...datos, ...JSON.parse(guardado) };
  } catch (error) {
    console.log("No se pudo leer lo guardado", error);
  }

  if (!Array.isArray(datos.servicios)) datos.servicios = [];

  if (datos.precioCorte > 0 && datos.servicios.length === 0) {
    datos.servicios.push({
      id: Date.now(),
      nombre: "Corte",
      precio: datos.precioCorte,
    });
  }
  delete datos.precioCorte;
}

function guardar() {
  try {
    localStorage.setItem(CLAVE_GUARDADO, JSON.stringify(datos));
  } catch (error) {
    console.log("No se pudo guardar", error);
  }
}

// Avisos

let temporizadorToast;

function mostrarToast(texto) {
  let toast = $("toast");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }

  toast.textContent = texto;
  toast.classList.add("visible");

  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => toast.classList.remove("visible"), 2000);
}

// Fechas

function hoyISO() {
  const ahora = new Date();
  ahora.setMinutes(ahora.getMinutes() - ahora.getTimezoneOffset());
  return ahora.toISOString().slice(0, 10);
}

function fechaValida(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const valor = new Date(anio, mes - 1, dia);
  return (
    valor.getFullYear() === anio &&
    valor.getMonth() === mes - 1 &&
    valor.getDate() === dia
  );
}

function nombreDelDia(fechaISO) {
  const manana = new Date();
  manana.setDate(manana.getDate() + 1);
  manana.setMinutes(manana.getMinutes() - manana.getTimezoneOffset());
  const mananaISO = manana.toISOString().slice(0, 10);

  if (fechaISO === hoyISO()) return "hoy";
  if (fechaISO === mananaISO) return "mañana";

  const [anio, mes, dia] = fechaISO.split("-");
  const fecha = new Date(anio, mes - 1, dia);
  return (
    "el " +
    fecha.toLocaleDateString("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    })
  );
}

// WhatsApp

function formatearTelefono(telefono) {
  let numero = telefono.replace(/\D/g, "");
  if (numero.startsWith("54")) return numero;
  numero = numero.replace(/^0/, "");
  return "549" + numero;
}

function telefonoValido(telefono) {
  const digitos = telefono.replace(/\D/g, "");
  return digitos.length >= 8 && digitos.length <= 15;
}

function armarMensaje(turno) {
  return datos.plantilla
    .replace("{nombre}", turno.nombre)
    .replace("{dia}", nombreDelDia(turno.fecha))
    .replace("{hora}", turno.hora)
    .replace("{negocio}", datos.negocio || "nuestro local");
}

function enviarRecordatorio(id) {
  const turno = datos.turnos.find((t) => t.id === id);
  if (!turno || !telefonoValido(turno.telefono || "")) {
    mostrarToast("El WhatsApp no es válido");
    return;
  }
  const link =
    "https://wa.me/" +
    formatearTelefono(turno.telefono) +
    "?text=" +
    encodeURIComponent(armarMensaje(turno));
  window.open(link, "_blank");
}

// Turnos

function limpiarFormulario() {
  $("nombre").value = "";
  $("hora").value = "";
  actualizarHoraSeleccionada("");
  $("telefono").value = "";
  $("fecha").value = hoyISO();
  $("btn-agregar").innerHTML =
    '<i class="bi bi-plus-lg" aria-hidden="true"></i>';
  $("btn-agregar").setAttribute("aria-label", "Agregar turno");
  $("btn-agregar").title = "Agregar turno";
  editandoId = null;
  $("nombre").focus();
}

// Sirve para crear un turno nuevo y también para guardar una edición
function guardarTurno() {
  const nombre = $("nombre").value.trim();
  const hora = $("hora").value;
  const fecha = $("fecha").value;
  const telefono = $("telefono").value.trim();

  // Mínimo necesario: nombre y hora
  if (!nombre) {
    mostrarToast("Escribí el nombre del cliente");
    $("nombre").focus();
    return;
  }
  if (nombre.length > 80) {
    mostrarToast("El nombre no puede superar 80 caracteres");
    $("nombre").focus();
    return;
  }
  if (!hora) {
    mostrarToast("Elegí un horario disponible");
    return;
  }
  if (!fechaValida(fecha) || fecha < hoyISO()) {
    mostrarToast("Elegí una fecha válida desde hoy");
    return;
  }
  if (telefono && !telefonoValido(telefono)) {
    mostrarToast("Revisá el número de WhatsApp");
    $("telefono").focus();
    return;
  }
  if (!horariosDelDia(fecha).some((slot) => slot.hora === hora && slot.libre)) {
    mostrarToast("Ese horario ya no está disponible");
    return;
  }

  if (editandoId) {
    const turno = datos.turnos.find((t) => t.id === editandoId);
    Object.assign(turno, { nombre, hora, fecha, telefono });
    mostrarToast("Turno corregido");
  } else {
    datos.turnos.push({
      id: Date.now(),
      nombre,
      hora,
      fecha,
      telefono,
      estado: "pendiente",
    });
    mostrarToast("Turno agregado");
  }

  guardar();
  limpiarFormulario();
  dibujarLista();
}

// Carga los datos del turno en el formulario para corregirlos
function editarTurno(id) {
  const turno = datos.turnos.find((t) => t.id === id);
  if (!turno) return;
  editandoId = id;

  $("nombre").value = turno.nombre;
  $("hora").value = turno.hora;
  actualizarHoraSeleccionada(turno.hora);
  $("fecha").value = turno.fecha;
  $("telefono").value = turno.telefono;
  $("btn-agregar").innerHTML =
    '<i class="bi bi-check-lg" aria-hidden="true"></i>';
  $("btn-agregar").setAttribute("aria-label", "Guardar cambios del turno");
  $("btn-agregar").title = "Guardar cambios del turno";

  $("nombre").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
  mostrarToast("Corregí y tocá ✓");
}

function cambiarEstado(id, nuevoEstado) {
  const turno = datos.turnos.find((t) => t.id === id);
  if (
    !turno ||
    !["pendiente", "confirmado", "cancelado", "ausente"].includes(nuevoEstado)
  )
    return;

  if (turno.cobrado && nuevoEstado !== "confirmado") {
    mostrarToast("Ese turno ya está cobrado");
    return;
  }

  turno.estado = nuevoEstado;
  guardar();
  dibujarLista();
  mostrarToast("Turno " + nuevoEstado);
}

function borrarTurno(id) {
  if (!confirm("¿Borrar turno?")) return;
  datos.turnos = datos.turnos.filter((t) => t.id !== id);
  guardar();
  dibujarLista();
  mostrarToast("Turno borrado");
}
// Horarios disponibles

const aMinutos = (hora) => {
  if (!PATRON_HORA.test(hora || "")) return NaN;
  const [h, m] = hora.split(":");
  return Number(h) * 60 + Number(m);
};

const aTexto = (minutos) =>
  String(Math.floor(minutos / 60)).padStart(2, "0") +
  ":" +
  String(minutos % 60).padStart(2, "0");

function horariosDelDia(fecha) {
  const { inicio, fin, duracion } = datos.horario;
  if (
    !fechaValida(fecha) ||
    !PATRON_HORA.test(inicio || "") ||
    !PATRON_HORA.test(fin || "") ||
    !Number.isInteger(duracion) ||
    duracion < 5 ||
    duracion > 480 ||
    aMinutos(inicio) >= aMinutos(fin)
  )
    return [];

  // Minutos de los turnos que siguen ocupando lugar ese día
  const ocupados = datos.turnos
    .filter(
      (t) =>
        t.fecha === fecha &&
        t.estado !== "cancelado" &&
        t.estado !== "ausente" &&
        t.id !== editandoId,
    )
    .map((t) => aMinutos(t.hora));

  const ahora = new Date();
  const minutosAhora = ahora.getHours() * 60 + ahora.getMinutes();
  const lista = [];

  for (let m = aMinutos(inicio); m < aMinutos(fin); m += duracion) {
    const ocupado = ocupados.some((o) => o >= m && o < m + duracion);
    const pasado = fecha === hoyISO() && m <= minutosAhora;
    lista.push({ hora: aTexto(m), libre: !ocupado && !pasado });
  }
  return lista;
}

function dibujarGrilla() {
  const fecha = $("modal-fecha").value;
  if (!fechaValida(fecha) || fecha < hoyISO()) {
    $("modal-grilla").innerHTML =
      '<p class="texto-suave">Elegí hoy o una fecha futura.</p>';
    return;
  }
  $("modal-grilla").innerHTML = horariosDelDia(fecha)
    .map((h) =>
      h.libre
        ? `<button onclick="elegirHorario('${h.hora}')">${h.hora}</button>`
        : `<button disabled>${h.hora}</button>`,
    )
    .join("");
}

function abrirModal() {
  $("modal-fecha").value = $("fecha").value || hoyISO();
  dibujarGrilla();
  $("modal-horarios").showModal();
}

function elegirHorario(hora) {
  $("hora").value = hora;
  actualizarHoraSeleccionada(hora);
  $("fecha").value = $("modal-fecha").value; // el turno queda en el día elegido
  $("modal-horarios").close();
  $("nombre").focus();
}

function actualizarHoraSeleccionada(hora) {
  const etiqueta = hora ? "Cambiar hora, " + hora : "Elegir hora disponible";
  $("hora-seleccionada").textContent = hora || "Elegir hora";
  $("btn-horarios").setAttribute("aria-label", etiqueta);
  $("btn-horarios").title = etiqueta;
}
// Caja

const pesos = (n) => "$" + Math.round(n).toLocaleString("es-AR");

function confirmar(texto, accion, textoBoton = "Borrar") {
  $("confirmar-texto").textContent = texto;
  $("btn-confirmar-si").textContent = textoBoton;

  $("btn-confirmar-si").onclick = () => {
    $("modal-confirmar").close();
    accion();
  };
  $("btn-confirmar-no").onclick = () => $("modal-confirmar").close();

  $("modal-confirmar").showModal();
}

function confirmarBorrado(registros, id, mensaje, redibujar, mensajeExito) {
  const registro = registros.find((r) => r.id === id);
  if (!registro) return;

  confirmar(mensaje(registro), () => {
    registros.splice(registros.indexOf(registro), 1);
    guardar();
    redibujar();
    mostrarToast(mensajeExito);
  });
}

function configurado() {
  return datos.servicios.length > 0 && datos.porcentaje > 0;
}

// ---------- Configuración: porcentaje y servicios ----------

function abrirConfig() {
  $("cfg-porcentaje").value = datos.porcentaje || "";
  $("cfg-error").textContent = "";
  dibujarServicios();
  $("modal-config").showModal();
}

function guardarConfig() {
  const porcentaje = Number($("cfg-porcentaje").value);

  if (!(porcentaje > 0 && porcentaje <= 100)) {
    $("cfg-error").textContent = "El porcentaje tiene que estar entre 1 y 100";
    return;
  }
  if (datos.servicios.length === 0) {
    $("cfg-error").textContent = "Agregá al menos un servicio";
    return;
  }

  datos.porcentaje = porcentaje;
  guardar();
  $("modal-config").close();
  mostrarToast("Valores guardados");
}

function dibujarServicios() {
  if (datos.servicios.length === 0) {
    $("cfg-servicios").innerHTML =
      '<div class="texto-suave">Todavía no cargaste servicios.</div>';
    return;
  }

  $("cfg-servicios").innerHTML = datos.servicios
    .map(
      (s) => `
    <div class="fila-corte">
      <span>${limpiarTexto(s.nombre)}</span>
      <span>
        <button onclick="cambiarPrecioServicio(${s.id})">${pesos(s.precio)}</button>
        <button onclick="borrarServicio(${s.id})" aria-label="Borrar servicio"><i class="bi bi-trash"></i></button>
      </span>
    </div>
  `,
    )
    .join("");
}

function agregarServicio() {
  const nombre = $("srv-nombre").value.trim();
  const precio = Number($("srv-precio").value);

  if (!nombre || !(precio > 0)) {
    $("cfg-error").textContent = "Poné el nombre y el precio del servicio";
    return;
  }

  datos.servicios.push({ id: Date.now(), nombre, precio });
  guardar();

  $("srv-nombre").value = "";
  $("srv-precio").value = "";
  $("cfg-error").textContent = "";
  dibujarServicios();
  $("srv-nombre").focus();
}

function cambiarPrecioServicio(id) {
  cambiarPrecio(
    datos.servicios,
    id,
    dibujarServicios,
    (servicio) => "Nuevo precio de " + servicio.nombre,
  );
}

function borrarServicio(id) {
  confirmarBorrado(
    datos.servicios,
    id,
    (servicio) =>
      `¿Borrar "${servicio.nombre}"? Los cortes ya registrados no cambian.`,
    dibujarServicios,
    "Servicio borrado",
  );
}

// ---------- Cobros ----------

function registrarCorte(nombre, servicio, precio, fecha) {
  const ahora = new Date();
  const hora =
    String(ahora.getHours()).padStart(2, "0") +
    ":" +
    String(ahora.getMinutes()).padStart(2, "0");

  datos.cortes.push({
    id: Date.now(),
    fecha,
    hora,
    nombre,
    servicio, // nombre del servicio en el momento del cobro
    precio,
    porcentaje: datos.porcentaje, // % vigente en el momento del cobro
  });
}

// Botón "$" de un turno
function cobrarTurno(id) {
  if (!configurado()) {
    abrirConfig();
    return;
  }

  const turno = datos.turnos.find((t) => t.id === id);
  if (!turno || turno.cobrado) return;

  if (turno.fecha > hoyISO()) {
    mostrarToast(
      "Ese turno es " + nombreDelDia(turno.fecha) + ". Cobralo ese día.",
    );
    return;
  }
  if (turno.estado === "cancelado" || turno.estado === "ausente") {
    mostrarToast(
      "El turno está " + turno.estado + ". Confirmalo antes de cobrar.",
    );
    return;
  }
  // Con un solo servicio no hace falta preguntar
  if (datos.servicios.length === 1) {
    cobrarConServicio(id, datos.servicios[0].id);
    return;
  }

  $("elegir-titulo").textContent = "¿Qué le hiciste a " + turno.nombre + "?";
  $("elegir-lista").innerHTML = datos.servicios
    .map(
      (s) => `
    <button onclick="cobrarConServicio(${id}, ${s.id})">
      <span>${limpiarTexto(s.nombre)}</span>
      <strong>${pesos(s.precio)}</strong>
    </button>
  `,
    )
    .join("");
  $("modal-elegir").showModal();
}

function cobrarConServicio(turnoId, servicioId) {
  const turno = datos.turnos.find((t) => t.id === turnoId);
  const servicio = datos.servicios.find((s) => s.id === servicioId);
  if (!turno || !servicio || turno.cobrado) return;

  if (turno.fecha > hoyISO()) {
    if ($("modal-elegir").open) $("modal-elegir").close();
    mostrarToast(
      "Ese turno es " + nombreDelDia(turno.fecha) + ". Cobralo ese día.",
    );

    if (turno.estado === "cancelado" || turno.estado === "ausente") {
      if ($("modal-elegir").open) $("modal-elegir").close();
      mostrarToast(
        "El turno está " + turno.estado + ". Confirmalo antes de cobrar.",
      );
      return;
    }
  }
  registrarCorte(turno.nombre, servicio.nombre, servicio.precio, turno.fecha);
  turno.cobrado = true;
  turno.estado = "confirmado";
  guardar();

  if ($("modal-elegir").open) $("modal-elegir").close();
  dibujarLista();
  mostrarToast("Cobrado " + servicio.nombre + " " + pesos(servicio.precio));
}

function agregarCorteManual() {
  const servicio = datos.servicios.find(
    (s) => s.id === Number($("corte-servicio").value),
  );
  if (!servicio) {
    mostrarToast("Elegí un servicio");
    return;
  }

  const nombre = $("corte-nombre").value.trim() || "Sin nombre";
  if (!fechaValida($("panel-fecha").value)) {
    mostrarToast("Elegí una fecha válida");
    return;
  }

  registrarCorte(
    nombre,
    servicio.nombre,
    servicio.precio,
    $("panel-fecha").value,
  );
  guardar();
  $("corte-nombre").value = "";
  dibujarPanel();
}

function cambiarPrecio(
  registros,
  id,
  redibujar,
  textoPregunta = () => "Nuevo precio",
) {
  const registro = registros.find((r) => r.id === id);
  if (!registro) return;

  const nuevo = Number(prompt(textoPregunta(registro), registro.precio));
  if (!(nuevo > 0)) return;

  registro.precio = nuevo;
  guardar();
  redibujar();
}

function cambiarPrecioCorte(id) {
  cambiarPrecio(datos.cortes, id, dibujarPanel);
}

function borrarCorte(id) {
  confirmarBorrado(
    datos.cortes,
    id,
    (corte) => `¿Borrar el corte de ${corte.nombre} (${pesos(corte.precio)})?`,
    dibujarPanel,
    "Corte borrado",
  );
}
function abrirPanel() {
  if (!configurado()) {
    abrirConfig();
    return;
  }
  $("panel-fecha").value = $("panel-fecha").value || hoyISO();
  dibujarPanel();
  $("panel-caja").showModal();
}

// ---------- Panel ----------

function dibujarPanel() {
  // Selector de servicios de la carga manual (conserva lo elegido)
  const elegido = $("corte-servicio").value;
  $("corte-servicio").innerHTML = datos.servicios
    .map(
      (s) =>
        `<option value="${s.id}">${limpiarTexto(s.nombre)} · ${pesos(s.precio)}</option>`,
    )
    .join("");
  if (elegido) $("corte-servicio").value = elegido;

  const verMes = $("panel-modo").value === "mes";
  const fecha = $("panel-fecha").value;

  const lista = datos.cortes
    .filter((c) =>
      verMes ? c.fecha.slice(0, 7) === fecha.slice(0, 7) : c.fecha === fecha,
    )
    .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));

  const resumen = lista.reduce(
    (resultado, corte) => {
      resultado.total += corte.precio;
      resultado.paraMi += (corte.precio * corte.porcentaje) / 100;

      const nombre = corte.servicio || "Corte";
      const detalle = resultado.porServicio.get(nombre) || {
        cantidad: 0,
        total: 0,
      };
      detalle.cantidad++;
      detalle.total += corte.precio;
      resultado.porServicio.set(nombre, detalle);
      return resultado;
    },
    { total: 0, paraMi: 0, porServicio: new Map() },
  );

  $("panel-resumen").innerHTML = `
    <div><span class="texto-suave">Cortes</span><strong>${lista.length}</strong></div>
    <div><span class="texto-suave">Total cobrado</span><strong>${pesos(resumen.total)}</strong></div>
    <div><span class="texto-suave">Te queda</span><strong class="destacado">${pesos(resumen.paraMi)}</strong></div>
  `;

  $("panel-desglose").innerHTML = [...resumen.porServicio]
    .map(
      ([nombre, detalle]) => `
    <div class="fila-corte">
      <span>${limpiarTexto(nombre)} × ${detalle.cantidad}</span>
      <strong>${pesos(detalle.total)}</strong>
    </div>
  `,
    )
    .join("");

  if (lista.length === 0) {
    $("panel-lista").innerHTML =
      '<div class="vacio">Todavía no hay cortes registrados.</div>';
    return;
  }

  $("panel-lista").innerHTML = lista
    .map(
      (c) => `
    <div class="fila-corte">
      <span>
        ${verMes ? c.fecha.slice(8) + "/" + c.fecha.slice(5, 7) + " · " : ""}${c.hora} · ${limpiarTexto(c.nombre)}
        <span class="texto-suave">${limpiarTexto(c.servicio || "Corte")}</span>
      </span>
      <span>
        <button onclick="cambiarPrecioCorte(${c.id})">${pesos(c.precio)}</button>
        <button onclick="borrarCorte(${c.id})" aria-label="Borrar corte"><i class="bi bi-trash"></i></button>
      </span>
    </div>
  `,
    )
    .join("");
}
// Lista de turnos

function limpiarTexto(texto) {
  const div = document.createElement("div");
  div.textContent = texto;
  return div.innerHTML;
}

function htmlDeTurno(turno) {
  const apagado =
    turno.estado === "cancelado" || turno.estado === "ausente" ? "apagada" : "";

  // El botón de WhatsApp existe solo si cargaron teléfono
  const botonWhatsapp = turno.telefono
    ? `<button class="btn-whatsapp" onclick="enviarRecordatorio(${turno.id})">
         <i class="bi bi-whatsapp"></i> Recordar
       </button>`
    : "";
  const esFuturo = turno.fecha > hoyISO();
  const sinCobro = turno.estado === "cancelado" || turno.estado === "ausente";

  const botonCobrar = turno.cobrado
    ? `<span class="texto-suave"><i class="bi bi-cash-coin"></i> Cobrado</span>`
    : esFuturo || sinCobro
      ? ""
      : `<button onclick="cobrarTurno(${turno.id})" aria-label="Cobrar"><i class="bi bi-cash-coin"></i></button>`;

  // Un turno cobrado ya está atendido: no se puede cancelar ni marcar ausente
  const botonesEstado = turno.cobrado
    ? ""
    : `
    <button onclick="cambiarEstado(${turno.id}, 'confirmado')" aria-label="Confirmar"><i class="bi bi-check-lg"></i></button>
       <button onclick="cambiarEstado(${turno.id}, 'cancelado')" aria-label="Cancelar"><i class="bi bi-x-lg"></i></button>
       <button onclick="cambiarEstado(${turno.id}, 'ausente')" aria-label="Ausente"><i class="bi bi-person-x"></i></button>`;

  return `
    <div class="tarjeta ${apagado}">
      <div class="turno-cabecera">
        <div>
          <span class="hora">${turno.hora}</span> · ${limpiarTexto(turno.nombre)}
        </div>
        <span class="estado ${turno.estado}">${turno.estado}</span>
      </div>

      <div class="acciones">
        ${botonWhatsapp}
        ${botonCobrar}
        ${botonesEstado}
        <button onclick="editarTurno(${turno.id})" aria-label="Editar"><i class="bi bi-pencil"></i></button>
        <button onclick="borrarTurno(${turno.id})" aria-label="Borrar"><i class="bi bi-trash"></i></button>
      </div>
    </div>
  `;
}

function dibujarLista() {
  const proximos = datos.turnos
    .filter((t) => t.fecha >= hoyISO())
    .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));

  $("contador").textContent = proximos.length + " próximos";

  if (proximos.length === 0) {
    $("lista").innerHTML =
      '<div class="vacio">Sin turnos. Escribí un nombre y una hora.</div>';
    return;
  }

  let html = "";
  let diaAnterior = "";

  proximos.forEach((turno) => {
    if (turno.fecha !== diaAnterior) {
      diaAnterior = turno.fecha;
      html += `<h2>${nombreDelDia(turno.fecha)}</h2>`;
    }
    html += htmlDeTurno(turno);
  });

  $("lista").innerHTML = html;
}
// =====================================================
// HISTORIAL
// =====================================================

const fechaCorta = (f) =>
  f.slice(8) + "/" + f.slice(5, 7) + "/" + f.slice(0, 4);

function abrirHistorial() {
  $("hist-buscar").value = "";
  dibujarHistorial();
  $("modal-historial").showModal();
}

function dibujarHistorial() {
  const texto = $("hist-buscar").value.trim().toLowerCase();

  const pasados = datos.turnos
    .filter(
      (t) =>
        t.fecha < hoyISO() &&
        (!texto || t.nombre.toLowerCase().includes(texto)),
    )
    .sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora));

  if (pasados.length === 0) {
    $("hist-lista").innerHTML =
      '<div class="vacio">No hay turnos anteriores.</div>';
    return;
  }

  // Al buscar un cliente, un resumen de sus visitas
  let resumen = "";
  if (texto) {
    const ausencias = pasados.filter((t) => t.estado === "ausente").length;
    const atendidos = pasados.filter(
      (t) => t.cobrado || t.estado === "confirmado",
    ).length;
    resumen = `
      <div class="tarjeta">
        <strong>${pasados.length} turnos</strong> · ${atendidos} atendidos · ${ausencias} ausencias
        <div class="texto-suave">Última visita: ${fechaCorta(pasados[0].fecha)}</div>
      </div>`;
  }

  $("hist-lista").innerHTML =
    resumen +
    pasados
      .map(
        (t) => `
    <div class="fila-corte">
      <span>${fechaCorta(t.fecha)} · ${t.hora} · ${limpiarTexto(t.nombre)}</span>
      <span class="estado ${t.estado}">${t.estado}</span>
    </div>
  `,
      )
      .join("");
}

// Inicio
$("btn-horarios").onclick = abrirModal;
$("modal-fecha").onchange = dibujarGrilla;
$("btn-cerrar-modal").onclick = () => $("modal-horarios").close();
cargar();

$("fecha").value = hoyISO();
$("negocio").value = datos.negocio;
$("plantilla").value = datos.plantilla;

$("btn-agregar").onclick = guardarTurno;

// Enter en el nombre también guarda el turno
$("nombre").addEventListener("keydown", (e) => {
  if (e.key === "Enter") guardarTurno();
});

$("btn-panel").onclick = abrirPanel;
$("btn-cerrar-panel").onclick = () => $("panel-caja").close();
$("btn-config").onclick = abrirConfig;
$("btn-guardar-config").onclick = guardarConfig;
$("btn-cancelar-config").onclick = () => $("modal-config").close();
$("btn-corte").onclick = agregarCorteManual;
$("panel-modo").onchange = dibujarPanel;
$("panel-fecha").onchange = dibujarPanel;
$("btn-srv-agregar").onclick = agregarServicio;
$("btn-elegir-cancelar").onclick = () => $("modal-elegir").close();
$("btn-historial").onclick = abrirHistorial;
$("btn-cerrar-historial").onclick = () => $("modal-historial").close();
$("hist-buscar").oninput = dibujarHistorial;

// Si se cierra la configuración (con Guardar, Cerrar o Esc), el panel se actualiza
$("modal-config").addEventListener("close", () => {
  if ($("panel-caja").open) dibujarPanel();
});

dibujarLista();
