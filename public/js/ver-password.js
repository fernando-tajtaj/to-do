// Agrega un botón "Mostrar / Ocultar" a cada campo de contraseña de la página
document.querySelectorAll('input[type="password"]').forEach((campo) => {
    const grupo = document.createElement('div');
    grupo.className = 'input-group';
    campo.parentNode.insertBefore(grupo, campo);
    grupo.appendChild(campo);

    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'btn btn-secundario btn-ver-password';
    boton.textContent = 'Mostrar';
    boton.setAttribute('aria-label', 'Mostrar contraseña');
    boton.setAttribute('aria-pressed', 'false');
    grupo.appendChild(boton);

    const mostrar = (visible) => {
        campo.type = visible ? 'text' : 'password';
        boton.textContent = visible ? 'Ocultar' : 'Mostrar';
        boton.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
        boton.setAttribute('aria-pressed', String(visible));
    };

    boton.addEventListener('click', () => {
        mostrar(campo.type === 'password');
        campo.focus();
    });
    // Al limpiar el formulario la contraseña vuelve a quedar oculta
    campo.form?.addEventListener('reset', () => mostrar(false));
});
