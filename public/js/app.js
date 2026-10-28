// Autenticación: iniciar sesión, crear cuenta y recuperar contraseña
const seccionLogin = document.getElementById('seccionLogin');
const seccionRegistro = document.getElementById('seccionRegistro');
const seccionRecuperar = document.getElementById('seccionRecuperar');
const mensajeAlerta = document.getElementById('mensajeAlerta');

const REGEX_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const REGEX_PASSWORD = /^(?=.*[A-Z])(?=.*\d).{8,}$/;

// Si ya hay sesión, ir directo al inicio
fetch('/api/sesion').then(res => { if (res.ok) window.location.href = '/dashboard.html'; }).catch(() => {});

function mostrarSeccion(seccion) {
    [seccionLogin, seccionRegistro, seccionRecuperar].forEach(s => (s.style.display = s === seccion ? 'block' : 'none'));
    mensajeAlerta.textContent = '';
    mensajeAlerta.className = 'mensaje-formulario';
    const primerCampo = seccion.querySelector('input');
    if (primerCampo) primerCampo.focus();
}

function mostrarMensaje(texto, tipo) {
    mensajeAlerta.className = `mensaje-formulario ${tipo === 'success' ? 'exito' : 'error'}`;
    mensajeAlerta.textContent = texto;
}

async function enviar(url, datos) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datos),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
}

document.getElementById('btnMostrarRegistro').addEventListener('click', (e) => { e.preventDefault(); mostrarSeccion(seccionRegistro); });
document.getElementById('btnMostrarLogin').addEventListener('click', (e) => { e.preventDefault(); mostrarSeccion(seccionLogin); });
document.getElementById('btnVolverLogin').addEventListener('click', (e) => { e.preventDefault(); mostrarSeccion(seccionLogin); });
document.getElementById('btnRecuperar').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('emailRecuperar').value = document.getElementById('emailLogin').value;
    mostrarSeccion(seccionRecuperar);
});

// El código de administrador solo se pide si se elige ese rol (el servidor lo valida)
document.getElementById('rolReg').addEventListener('change', (e) => {
    document.getElementById('contenedorCodigoAdmin').style.display = e.target.value === 'Administrador' ? 'block' : 'none';
});

// CREAR CUENTA
document.getElementById('registroForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = document.getElementById('nombreReg').value.trim();
    const correo = document.getElementById('emailReg').value.trim();
    const password = document.getElementById('passwordReg').value;
    const rol = document.getElementById('rolReg').value;
    const codigoAdmin = document.getElementById('codigoAdmin').value;

    if (!nombre || !correo || !password || !rol) return mostrarMensaje('Todos los campos son obligatorios.', 'danger');
    if (nombre.length < 3) return mostrarMensaje('El nombre debe tener al menos 3 caracteres.', 'danger');
    if (!REGEX_CORREO.test(correo)) return mostrarMensaje('El formato del correo no es válido.', 'danger');
    if (!REGEX_PASSWORD.test(password)) return mostrarMensaje('La contraseña debe tener al menos 8 caracteres, una mayúscula y un número.', 'danger');
    if (rol === 'Administrador' && !codigoAdmin) return mostrarMensaje('Ingresa el código de administrador.', 'danger');

    try {
        const { ok, data } = await enviar('/api/registro', { nombre, correo, password, rol, codigoAdmin });
        if (!ok) return mostrarMensaje(data.error || 'No se pudo crear la cuenta.', 'danger');
        document.getElementById('registroForm').reset();
        document.getElementById('contenedorCodigoAdmin').style.display = 'none';
        document.getElementById('emailLogin').value = correo;
        mostrarSeccion(seccionLogin);
        mostrarMensaje('Cuenta creada. Ya puedes iniciar sesión.', 'success');
    } catch (error) {
        mostrarMensaje('Error al conectar con el servidor.', 'danger');
    }
});

// INICIAR SESIÓN
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const correo = document.getElementById('emailLogin').value.trim();
    const password = document.getElementById('passwordLogin').value;
    if (!correo || !password) return mostrarMensaje('Correo y contraseña son obligatorios.', 'danger');
    if (!REGEX_CORREO.test(correo)) return mostrarMensaje('El formato del correo no es válido.', 'danger');

    try {
        const { ok, data } = await enviar('/api/login', { correo, password });
        if (!ok) return mostrarMensaje(data.error || 'No se pudo iniciar sesión.', 'danger');
        window.location.href = '/dashboard.html';
    } catch (error) {
        mostrarMensaje('Error al conectar con el servidor.', 'danger');
    }
});

// RECUPERAR CONTRASEÑA (envía un enlace al correo vía BillionMail o Ethereal en pruebas)
document.getElementById('recuperarForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const correo = document.getElementById('emailRecuperar').value.trim();
    if (!REGEX_CORREO.test(correo)) return mostrarMensaje('Ingresa un correo válido.', 'danger');
    const btnEnviar = document.getElementById('btnEnviarRecuperar');
    btnEnviar.disabled = true;
    btnEnviar.textContent = 'Enviando…';

    try {
        const { ok, data } = await enviar('/api/recuperar', { correo });
        if (!ok) return mostrarMensaje(data.error || 'No se pudo enviar el correo.', 'danger');
        mostrarMensaje(data.mensaje, 'success');
        document.getElementById('recuperarForm').reset();
        // Modo prueba: el servidor devuelve un enlace para ver el correo enviado
        if (data.vistaPrevia) {
            const enlace = document.createElement('a');
            enlace.href = data.vistaPrevia;
            enlace.target = '_blank';
            enlace.rel = 'noopener';
            enlace.className = 'd-block mt-1 fw-semibold';
            enlace.textContent = 'Ver correo de prueba';
            mensajeAlerta.appendChild(enlace);
        }
    } catch (error) {
        mostrarMensaje('Error al conectar con el servidor.', 'danger');
    } finally {
        btnEnviar.disabled = false;
        btnEnviar.textContent = 'Enviar enlace';
    }
});
