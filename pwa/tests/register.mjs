// Registers the module hooks that let node's built-in test runner load the app's stores unchanged.
import { register } from 'node:module';
register('./loader.mjs', import.meta.url);
