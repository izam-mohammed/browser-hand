// Entry for the MAIN-world content script (manifest, document_start).
import { installHooks } from "./hooks";

installHooks(window);
