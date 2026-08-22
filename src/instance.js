import Bonjour from "bonjour-service";
const bonjour = new Bonjour.Bonjour();
import config from "../config.js";
import { getResponse } from "./networking.js";

export async function checkForAvailableInstance() {
    const instances = config.get("allInstances");

    if (instances?.length > 1) {
        bonjour.find({ type: "home-assistant" }, (instance) => {
            if (instance.txt.internal_url && instances.indexOf(instance.txt.internal_url) !== -1) {
                return currentInstance(instance.txt.internal_url);
            }

            if (instance.txt.external_url && instances.indexOf(instance.txt.external_url) !== -1) {
                return currentInstance(instance.txt.external_url);
            }
        });
        let found;
        for (const instance of instances.filter((e) => e.url !== currentInstance())) {
            const statusCode = await getResponse(instance, 8000);
            if (statusCode === 200) {
                found = instance;
            }
            if (found) {
                currentInstance(found);
                break;
            }
        }
    }
}

export function currentInstance(url = null) {
    if (url) {
        config.set("currentInstance", config.get("allInstances").indexOf(url));
    }

    if (config.has("currentInstance")) {
        return config.get("allInstances")[config.get("currentInstance")];
    }

    return false;
}
