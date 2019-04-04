import { Project } from '../api';
import { Readable } from 'stream';
interface PublishOptions {
    otp?: string;
    tag?: string;
    public?: boolean | void;
}
export declare function pack(project: Project, files: void | string[], ignore: void | string[]): {
    files: string[];
    stream: Readable;
};
export default function publish(project: Project, opts: PublishOptions): Promise<void>;
export {};
