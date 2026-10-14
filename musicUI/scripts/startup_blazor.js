// Loaded after the Blazor framework script, with automatic startup disabled.
window.musicuiStartup.startBlazor().catch(error => {
    console.error(error);
    const recovery = document.getElementById('blazor-error-ui');
    if (recovery) recovery.style.display = 'block';
});
