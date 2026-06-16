type ReleaseConfig = {
    /** Named groups of packages for selective bumping. */
    groups?: Record<string, {
        packages: string[];
    }>;
    /** Git remotes to push tags to. Default: ["origin"] */
    remotes?: string[];
    /** Build command. Default: "pnpm build" */
    buildCommand?: string;
    /** Test command. Default: "pnpm test" */
    testCommand?: string;
    /** npm access level. Default: "public" for @scoped packages */
    access?: "public" | "restricted";
};
declare function defineConfig(config: ReleaseConfig): ReleaseConfig;

export { type ReleaseConfig, defineConfig };
