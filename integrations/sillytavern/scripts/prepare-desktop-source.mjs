import { prepareDesktopCheckouts, prepareHelperPackages, verifyDesktopInputs } from './lib/desktop-source-inputs.mjs';

prepareDesktopCheckouts();
verifyDesktopInputs({ prepare: true });
prepareHelperPackages();
