 (async () => {
  try {
      const mod = await import('./server.js');
      console.log('Loaded ESM module keys:', Object.keys(mod));
      console.log('startServer present:', typeof mod.startServer);
      if (mod && typeof mod.startServer === 'function') {
        await mod.startServer();
      } else if (mod && mod.default && typeof mod.default.startServer === 'function') {
        console.log('Found startServer on default export, calling that.');
        await mod.default.startServer();
      } else {
        console.error('startServer not found on imported module.');
      }
  } catch (err) {
    console.error('Failed to start ESM server:', err);
    process.exit(1);
  }
})();
