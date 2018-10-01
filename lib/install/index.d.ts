import { Project } from '../api';
import { PackageTarget, PackageConfig, DepType } from './package';
export interface InstallOptions {
    verify?: boolean;
    edge?: boolean;
    lock?: boolean;
    latest?: boolean;
    dedupe?: boolean;
    optional?: boolean;
    reset?: boolean;
    exact?: boolean;
}
export interface Install {
    name: string;
    parent: string | void;
    target: PackageTarget | string;
    type: DepType;
    override?: PackageConfig | void;
}
export declare class Installer {
    binFolderChecked: boolean;
    private opts;
    private project;
    private config;
    private registryManager;
    private installTree;
    private primaryType;
    private installs;
    private sourceInstalls;
    offline: boolean;
    preferOffline: boolean;
    private secondaryRanges;
    private primaryRanges;
    private jspmPackageInstallStateCache;
    private globalPackagesPath;
    private changed;
    private busy;
    private updatePrimaryRanges;
    constructor(project: Project);
    dispose(): void;
    ensureNotBusy(): void;
    update(selectors: string[], opts: InstallOptions): Promise<boolean>;
    link(pkg: string, source: string, opts: InstallOptions): Promise<boolean>;
    checkout(selectors: string[]): Promise<void>;
    uninstall(names: string[]): Promise<boolean>;
    install(installs: Install[], opts: InstallOptions): Promise<boolean>;
    private getOverride;
    private cutOverride;
    private setOverride;
    private packageInstall;
    private sourceInstall;
    private createBins;
    private resourceInstall;
    private installDependencies;
    private setResolution;
    getPackagePath(name: string): string;
    private createCheckoutPrompt;
    private readCheckedOutConfig;
    private upgradePackagesTo;
    private setPackageToHash;
    private setPackageToLinked;
    private packageExists;
    private isPackageCheckedOut;
    private getPackageInstallState;
    private ensureInstallRanges;
    clean(save?: boolean): Promise<boolean>;
}
