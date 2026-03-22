export function setupThemeSwitcher() {
  const themeSwitch = document.getElementById('theme-switch')! as HTMLInputElement;
  let darkMode = true;
  if (localStorage.getItem('theme') === 'dark') {
    darkMode = true;
  } else if (localStorage.getItem('theme') === 'light') {
    darkMode = false;
  }
  document.documentElement.classList.toggle('dark', darkMode);
  themeSwitch.checked = darkMode;
  themeSwitch.addEventListener('change', () => {
    document.documentElement.classList.toggle('dark');
    localStorage.setItem(
      'theme',
      document.documentElement.classList.contains('dark') ? 'dark' : 'light'
    );
  });
}
