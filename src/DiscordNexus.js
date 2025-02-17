import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { configDotenv } from "dotenv";
import {
    existsSync,
    readFileSync,
    writeFileSync,
    mkdirSync
} from "fs";
import { SetupWizard } from "./application/SetupWizard.js";
import { VersionInfo } from "./VersionInfo.js";
import path from "path";
import { BaseConsole } from "./utils/BaseConsole.js";
import { LocalData, LocalDataTypes } from "./utils/LocalData.js";
import { PluginManager } from "./plugin/PluginManager.js";
import { Translatable } from "./lang/Translatable.js";
import { TranslationKeys } from "./lang/TranslationKeys.js";
import { ConsoleReader } from "./console/ConsoleReader.js";
import { CommandMap } from "./command/CommandMap.js";
import { Language } from "./lang/Language.js";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { MemoryManager } from "./MemoryManager.js";
import { TextFormat } from "./utils/TextFormat.js";
import { CLI } from "./utils/CLI.js";
import { Network } from "./network/Network.js";
import { configure } from "crashreporter";
import { String } from "./utils/String.js";
import { File } from "./utils/File.js";
import { NexusConfigurationConstants } from "./NexusConfigurationConstants.js";

global.LANGUAGE_PATH = "./src/lang/defaults";

export class DiscordNexus extends Client {

    baseConsole;
    configuration;
    pluginManager;
    nexusProperties;
    administrators;
    language;
    commandMap;
    memoryManager;
    network;

    constructor() {
        const options = {
            intents: Object.keys(GatewayIntentBits).map((a) => {
                return GatewayIntentBits[a]
            }),
            partials: Object.keys(Partials).map((a) => {
                return Partials[a]
            })
        };
        super(options);
        
        configDotenv()

        CLI.setTerminalTitle(`${VersionInfo.NAME} ${VersionInfo.VERSION}`)

        const currentFilePath = fileURLToPath(import.meta.url);
        const currentDirPath = dirname(currentFilePath);
        global.dataPath = currentDirPath;
        this.baseConsole = new BaseConsole();
        this.pluginManager = new PluginManager(this);
        this.commandMap = new CommandMap(this);
        this.start().then(async (OK) => {
            if (!OK) return this.shutdown();

            const DiscordNexusJSON = "nexus.yml";
            if (!existsSync(DiscordNexusJSON)) {
                const content = readFileSync(path.join(this.getDataPath(), "resources", "nexus.yml"), 'utf-8');
                writeFileSync(DiscordNexusJSON, content);
            }
            this.configuration = new LocalData(DiscordNexusJSON, LocalDataTypes.YAML);
            this.memoryManager = new MemoryManager(this);

            const AdministratorsTxt = "administrators.txt"
            if (!existsSync(AdministratorsTxt)) {
                writeFileSync(AdministratorsTxt, "");
            }
            this.administrators = new LocalData(AdministratorsTxt, LocalDataTypes.TXT);

            if (this.getNexusConfig().getNested(NexusConfigurationConstants.SERVER_DEBUG)) {
                this.on('debug', (info) => {
                    this.getBaseConsole().debug(info);
                })
            }
            
            this.getBaseConsole().info(this.language.get(TranslationKeys.NEXUS_LOADING_CONFIGURATION));

            const defaultEvents = Object.keys(Events).map((a) => Events[a]);
            for (const event of defaultEvents) {
                const capitalizedEventName = String.capitalizeFirstLetter(event);
                const eventName = `${capitalizedEventName}Event`;
                const eventFile = `${eventName}.js`;
                const eventFilePath = File.findFile(`./src/event`, eventFile);
                if (eventFilePath) {
                    const module = await import(`./event/${eventFilePath}`);
                    this.on(event, (...args) => {
                        const eventClass = new (module[eventName])(...args);
                        this.getPluginManager().callEvent(eventClass);
                    })
                }
            }
            
            const pluginsPath = "plugins";
            const pluginDataPath = "plugin_data"
            if (!existsSync(pluginDataPath)) {
                mkdirSync(pluginDataPath);
            }
            if (!existsSync(pluginsPath)) {
                mkdirSync(pluginsPath);
            } else {
                await this.getPluginManager().loadPlugins(pluginsPath);
            }
            
            this.login(process.env.CLIENT_TOKEN)
                .then(() => {
                    this.on(Events.InteractionCreate, async (interaction) => {
                        if (interaction.isChatInputCommand()) {
                            const command = this.getCommandMap().getCommand(interaction.commandName);
                
                            if (command) {
                                try {
                                    if (command.administrator && !this.isAdministrator(interaction.user.id)) {
                                        return await interaction.reply({
                                            ephemeral: true,
                                            content: this.language.get(TranslationKeys.COMMAND_NOT_ADMINISTRATOR)
                                        })
                                    }
                                    if (interaction.isAutocomplete()) {
                                        if (command) {
                                            await command.autoComplete(interaction);
                                        }
                                    }
                                    await command.execute(interaction.user, interaction, interaction.options);
                                } catch (e) {}
                            }
                        }
                    });
                    console.log(
                        this.getLanguage().translate(
                            new Translatable(TranslationKeys.NEXUS_LOGIN_INFO, [TextFormat.format(this.user.username, TextFormat.colors.green)])
                        )
                    );
                })
    
            
            new ConsoleReader(this);
            if (VersionInfo.IS_DEVELOPMENT_BUILD) {
                this.getBaseConsole().warn(this.getLanguage().get(TranslationKeys.NEXUS_DEVBUILD));
            }
        })

        process.on('SIGINT', () => {
            this.shutdown();
            process.exit();
        });
    }

    isAdministrator(userId) {
        return this.administrators.getAll().includes(userId)
    }

    addAdministrator(userId) {
        const list = this.administrators.getAll()
        list.push(userId)
        this.administrators.setAll(list)
        this.administrators.save()
    }

    removeAdministrator(userId) {
        const list = this.administrators.getAll()
        this.administrators.setAll(list.filter(user_id => user_id != userId))
        this.administrators.save()
    }

    getDataPath() {
        return dataPath;
    }

    /**
     * @returns {BaseConsole}
     */
    getBaseConsole() {
        return this.baseConsole;
    }

    /**
     * @returns {PluginManager}
     */
    getPluginManager() {
        return this.pluginManager;
    }

    /**
     * @returns {LocalData}
     */
    getNexusConfig() {
        return this.configuration;
    }

    /**
     * @returns {LocalData}
     */
    getNexusProperties() {
        return this.nexusProperties;
    }

    /**
     * @returns {Language}
     */
    getLanguage() {
        return this.language;
    }

    /**
     * @returns {CommandMap}
     */
    getCommandMap() {
        return this.commandMap;
    }

    /**
     * @returns {MemoryManager}
     */
    getMemoryManager() {
        return this.memoryManager;
    }

    /**
     * @returns {Network}
     */
    getNetwork() {
        return this.network;
    }

    start = async () => {
        if (!existsSync("nexus.properties")) {
            const installer = new SetupWizard(this)
            if (!await installer.run()) {
                return false;
            }
        }
        this.nexusProperties = new LocalData("nexus.properties", LocalDataTypes.PROPERTIES);

        const languageSelected = this.nexusProperties.get("language");
        this.language = new Language(languageSelected);

        if (this.getNexusProperties().get("cron-enable")) {
            this.network = new Network(this);
        }

        const crashDumpsDir = "./crashdumps";
        if (!existsSync(crashDumpsDir)) {
            mkdirSync(crashDumpsDir);
        }
        configure({
            outDir: crashDumpsDir,
            exitOnCrash: true,
            hiddenAttributes: ['execPath', 'argv', 'currentDirectory', 'env', 'pid', 'processTitle', 'versions', 'memoryUsage', 'requireCache', 'activeHandle', 'activeRequest']
        })
        
        return true;
    }

    shutdown() {
        this.getPluginManager().disablePlugins();
        // this.destroy();
        process.kill(process.pid, 'SIGINT');
    }
}


new DiscordNexus()
