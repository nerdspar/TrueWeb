/**
 * Shapes shared between the pre-flight endpoint and the paste screen. They live
 * here, not in $lib/server, so the client can import the types without pulling
 * a server-only module into the browser bundle.
 */
import type { ProvisionKind } from './paths.ts';

export type FsType = 'DIRECTORY' | 'FILE' | 'SYMLINK' | 'OTHER';

export interface PathReport {
	path: string;
	exists: boolean;
	/** Present when the path already exists. */
	type?: FsType;
	isMountpoint?: boolean;
	uid?: number;
	gid?: number;
	owner?: string | null;
	/** Deepest ancestor that exists — where creation would start. */
	existingAncestor: string | null;
	/** Segments that need creating, outermost first. */
	missing: string[];
	/** What we'd create by default (§5.2). */
	recommended: ProvisionKind;
	/** The ZFS name a dataset would take, when a dataset is possible at all. */
	datasetName: string | null;
	/** Why a dataset isn't on offer, when it isn't. */
	note?: string;
}

export interface PreflightResult {
	nameTaken: boolean;
	portConflicts: number[];
	paths: PathReport[];
}
