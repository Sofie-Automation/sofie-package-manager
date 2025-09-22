import { StatusCode as SofieStatusCode } from '@sofie-automation/shared-lib/dist/lib/status'
import { PackageContainerId, ExpectedPackageId, AccessorId } from './ids'

// import { assertTrue, EnumExtends, assertEnumValuesExtends } from './lib'
/* eslint-disable @typescript-eslint/no-namespace */

/*
	This file contains a copy of the package-related types from blueprints-integration.
	Other libraries should (when possible) refer to these types instead of blueprints-integration directly.

	The reason for this is to allow for easier addition of custom types without
	having to update the blueprints-integration library.

	Note: When adding types in this file, consider opening a PR to Sofie Core (https://github.com/Sofie-Automation/sofie-core)
	later to add it into blueprints-integration.
*/

export type StatusCode = SofieStatusCode
export const StatusCode = SofieStatusCode

/**
 * An ExpectedPackage is sent from Core to the Package Manager, to signal that a Package (ie a Media file) should be copied to a playout-device.
 * It used by core to describe what Packages are needed on various sources.
 * Example: A piece uses a media file for playout in CasparCG. The media file will then be an ExpectedPackage, which the Package Manager
 *   will fetch from a MAM and copy to the media-folder of CasparCG.
 */

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace ExpectedPackage {
	export type Any =
		| ExpectedPackageMediaFile
		| ExpectedPackageQuantelClip
		| ExpectedPackageJSONData
		| ExpectedPackageHtmlTemplate

	export enum PackageType {
		MEDIA_FILE = 'media_file',
		QUANTEL_CLIP = 'quantel_clip',
		JSON_DATA = 'json_data',
		HTML_TEMPLATE = 'html_template',

		// TALLY_LABEL = 'tally_label'

		// VIZ_GFX = 'viz_gfx'
	}

	/** Generic (used in extends) */
	export interface Base {
		/** Unique id of the expectedPackage */
		_id: ExpectedPackageId
		/** Reference to which timeline-layer(s) the Package is going to be used in.
		 * (Used to route the package to the right playout-device (targets))
		 */
		layers: string[]

		/** What type of package it is */
		type: PackageType

		/** Whether the blueprints should be notified (re-run) on any package info updates */
		listenToPackageInfoUpdates?: boolean

		/** Definition of the content of the Package.
		 * With "content", we mean what's the basic definition of a package. For a media file, think "filename".
		 */
		content: unknown
		/** Definition of the version of the Package
		 * A "version" is used to differ between different "modifications" for the same content. For a media file, think "modified date".
		 */
		version: unknown

		/** Hash that changes whenever the content or version changes. */
		contentVersionHash: string

		/** Definition of the source-PackageContainers of the Package
		 * The source is used by the package manager to be able to be able to do an action on the Package. For a media file about to be copied, think "source file path".
		 * Multiple sources can be defined, in order of preference(?)
		 */
		sources: {
			/** Reference to a PackageContainer */
			containerId: PackageContainerId
			/** Locally defined Accessors, these are combined (deep extended) with the PackageContainer (if it is found) Accessors */
			accessors: {
				[accessorId: AccessorId]: AccessorOnPackage.Any
			}
		}[]

		/** The sideEffect is used by the Package Manager to generate extra artifacts, such as thumbnails & previews */
		sideEffect: {
			/** Which container previews are to be put into */
			previewContainerId?: PackageContainerId | null // null is used to disable the sideEffect
			previewPackageSettings?: SideEffectPreviewSettings | null

			/** Which container thumbnails are to be put into */
			thumbnailContainerId?: PackageContainerId | null // null is used to disable the sideEffect
			thumbnailPackageSettings?: SideEffectThumbnailSettings | null

			/** Should the package be scanned for loudness */
			loudnessPackageSettings?: SideEffectLoudnessSettings

			/** Should the package be scanned for I-frames */
			iframes?: SideEffectIframesScanSettings

			/** Other custom configuration */
			[key: string]: any
		}
	}
	export interface SideEffectPreviewSettings {
		/** What the preview package filePath is going to be */
		path: string
	}
	export interface SideEffectThumbnailSettings {
		/** What the thumbnails package filePath is going to be */
		path: string
		/** What time to pick the thumbnail from [ms] */
		seekTime?: number
	}

	export interface SideEffectLoudnessSettings {
		/** Which channels should be scanned. Use a single 0-indexed number, or two numbers with a plus sign ("0+1") for stereo pairs.
		 * You can specify multiple channels and channel pairs to be scanned, as separate entries in the array. This can be useful
		 * when the streams contain different language versions or audio that will be played jointly, but processed separately
		 * in the production chain (f.g. a stereo mix of a speaker and a stereo ambient sound mix)
		 *
		 * When expecting varied channel arrangements within the clip, it can be useful to specify multiple combinations,
		 * f.g. ["0", "0+1"] (for single stream stereo and discreet channel stereo) and then select the correct measurement in the
		 * blueprints based on the context */
		channelSpec: SideEffectLoudnessSettingsChannelSpec[]

		/** Calculate phase difference between stereo channels in the tracks */
		inPhaseDifference?: boolean

		/** Calculate balance difference between stereo channels in the tracks */
		balanceDifference?: boolean
	}

	export type SideEffectLoudnessSettingsChannelSpec = `${number}` | `${number}+${number}`

	export type SideEffectIframesScanSettings = Record<string, never>

	export interface ExpectedPackageMediaFile extends Base {
		type: PackageType.MEDIA_FILE
		content: {
			/** Local file path on the package container */
			filePath: string
		}
		version: {
			fileSize?: number // in bytes
			modifiedDate?: number // timestamp (ms)
			checksum?: string
			checkSumType?: 'sha' | 'md5' | 'whatever'
		}
		sources: {
			containerId: PackageContainerId
			accessors: {
				[accessorId: AccessorId]:
					| AccessorOnPackage.LocalFolder
					| AccessorOnPackage.FileShare
					| AccessorOnPackage.HTTP
					| AccessorOnPackage.HTTPProxy
					| AccessorOnPackage.Quantel
			}
		}[]
	}
	export interface ExpectedPackageQuantelClip extends Base {
		type: PackageType.QUANTEL_CLIP
		content:
			| {
					guid: string
					title?: string
			  }
			| {
					guid?: string
					title: string
			  }
		version: {
			/** The time the clips was created */
			created?: string
			/** Quantel cloneId defines a clip across multiple servers */
			cloneId?: number
		}
		sources: {
			containerId: PackageContainerId
			accessors: { [accessorId: AccessorId]: AccessorOnPackage.Quantel }
		}[]
	}

	export interface ExpectedPackageJSONData extends Base {
		type: PackageType.JSON_DATA
		content: {
			/** Local path on the package container */
			path: string
		}
		version: any // {}
		sources: {
			containerId: PackageContainerId
			accessors: {
				[accessorId: AccessorId]:
					| AccessorOnPackage.HTTP
					| AccessorOnPackage.HTTPProxy
					| AccessorOnPackage.LocalFolder
					| AccessorOnPackage.FileShare
			}
		}[]
	}
	export interface ExpectedPackageHtmlTemplate extends Base {
		type: PackageType.HTML_TEMPLATE
		content: {
			/** path to the HTML template */
			path: string
		}
		version: {
			renderer?: {
				/** Renderer width, defaults to 1920 */
				width?: number
				/** Renderer height, defaults to 1080 */
				height?: number
				/**
				 * Scale the rendered width and height with this value, and also zoom the content accordingly.
				 * For example, if the width is 1920 and scale is 0.5, the width will be scaled to 960.
				 * (Defaults to 1)
				 */
				scale?: number
				/** Background color, #RRGGBB, CSS-string, "transparent" or "default" (defaults to "default") */
				background?: string
				userAgent?: string
			}

			/**
			 * Convenience settings for a template that follows the typical CasparCG steps;
			 * update(data); play(); stop();
			 * If this is set, steps are overridden */
			casparCG?: {
				/**
				 * Data to send into the update() function of a CasparCG Template.
				 * Strings will be piped through as-is, objects will be JSON.stringified.
				 */
				data: { [key: string]: any } | null | string

				/** How long to wait between each action in a CasparCG template, (default: 1000ms) */
				delay?: number
			}

			steps?: (
				| { do: 'waitForLoad' }
				| { do: 'sleep'; duration: number }
				| {
						do: 'sendHTTPCommand'
						url: string
						/** GET, POST, PUT etc.. */
						method: string
						body?: ArrayBuffer | ArrayBufferView | NodeJS.ReadableStream | string | URLSearchParams

						headers?: Record<string, string>
				  }
				| { do: 'takeScreenshot'; fileName: string }
				| { do: 'startRecording'; fileName: string }
				| { do: 'stopRecording' }
				| { do: 'cropRecording'; fileName: string }
				| { do: 'executeJs'; js: string }
				// Store an object in memory
				| {
						do: 'storeObject'
						key: string
						/** The value to store into memory. Either an object, or a JSON-stringified object */
						value: Record<string, any> | string
				  }
				// Modify an object in memory. Path is a dot-separated string
				| { do: 'modifyObject'; key: string; path: string; value: any }
				// Send an object to the renderer as a postMessage (so basically does a executeJs: window.postMessage(memory[key]))
				| {
						do: 'injectObject'
						key: string
						/** The method to receive the value. Defaults to window.postMessage */
						receivingFunction?: string
				  }
			)[]
		}
		sources: {
			containerId: PackageContainerId
			accessors: {
				[accessorId: AccessorId]:
					| AccessorOnPackage.LocalFolder
					| AccessorOnPackage.FileShare
					| AccessorOnPackage.HTTP
					| AccessorOnPackage.HTTPProxy
			}
		}[]
	}
}

/** A PackageContainer defines a place that contains Packages, that can be read or written to.
 * For example:
 *   A PackageContainer could be a folder on a computer that contains media files.
 *   That folder could be accessed locally (Accessor.LocalFolder)
 *   and if the folder is shared, by a Accessor.FileShare over the network
 */
export interface PackageContainer {
	/** Short name, for displaying to user */
	label: string

	/** A list of ways to access the PackageContainer. Note: The accessors are different ways to access THE SAME PackageContainer. */
	accessors: { [accessorId: AccessorId]: Accessor.Any }
}

/** Defines different ways of accessing a PackageContainer.
 * For example, a local folder on a computer might be accessed through a LocalFolder and a FileShare
 */
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Accessor {
	export type Any =
		| LocalFolder
		| FileShare
		| HTTP
		| HTTPProxy
		| Quantel
		| CorePackageCollection
		| AtemMediaStore
		| FTP

	export enum AccessType {
		LOCAL_FOLDER = 'local_folder',
		FILE_SHARE = 'file_share',
		HTTP = 'http',
		HTTP_PROXY = 'http_proxy',
		QUANTEL = 'quantel',
		CORE_PACKAGE_INFO = 'core_package_info',
		ATEM_MEDIA_STORE = 'atem_media_store',
		FTP = 'ftp',
	}

	/** Generic (used in extends) */
	export interface Base {
		type: AccessType
		label: string
		allowRead: boolean
		allowWrite: boolean
	}
	/** Definition of access to a local folder. */
	export interface LocalFolder extends Base {
		type: AccessType.LOCAL_FOLDER

		/** Name/id of the resource, this could for example be the computer name. */
		resourceId?: string // todo: rename?

		/** Path to the folder
		 * @example 'C:\media\'
		 */
		folderPath: string
	}
	/** Definition of a file share over a network. */
	export interface FileShare extends Base {
		type: AccessType.FILE_SHARE

		/** Name/Id of the network the share exists on. Used to differ between different local networks. */
		networkId?: string

		/** Path to a folder on a network-share
		 * @example '\\192.168.0.1\shared\'
		 */
		folderPath: string

		userName?: string
		password?: string
	}
	/** Definition of access to a generic HTTP endpoint. (Read-access only) */
	export interface HTTP extends Base {
		type: AccessType.HTTP
		allowWrite: false

		/** Base url (url to the host), for example http://myhost.com/fileShare/ */
		baseUrl?: string

		/** Name/Id of the network the share exists on. Used to differ between different local networks. Leave empty if globally accessible. */
		networkId?: string

		/** If true, assumes that a source never changes once it has been fetched. */
		isImmutable?: boolean

		/** If true, assumes that the source doesn't support HEAD requests and will use GET instead. If false, HEAD requests will be sent to check availability. */
		useGETinsteadOfHEAD?: boolean
	}
	/** Definition of access to the HTTP-proxy server that comes with Package Manager. */
	export interface HTTPProxy extends Base {
		type: AccessType.HTTP_PROXY

		/** Base url (url to the host), for example http://myhost.com/fileShare/ */
		baseUrl: string

		/** Name/Id of the network the share exists on. Used to differ between different local networks. Leave empty if globally accessible. */
		networkId?: string
	}
	export interface Quantel extends Base {
		type: AccessType.QUANTEL

		/** URL to a Quantel-gateway (https://github.com/Sofie-Automation/sofie-quantel-gateway) */
		quantelGatewayUrl: string

		/** Locations of the Quantel ISA:s (in order of importance) */
		ISAUrls: string[]

		/** Zone id, defaults to 'default' */
		zoneId?: string
		/** Server id. Should be omitted for sources, as clip-searches are zone-wide */
		serverId?: number

		/** Name/Id of the network the share exists on. Used to differ between different networks. Leave empty if globally accessible. */
		networkId?: string

		/** URL to a HTTP-transformer. Used for thumbnails, previews etc.. (http://hostname:port) */
		transformerURL?: string

		/** URL to a FileFlow Manager. Used for copying clips into CIFS file shares */
		fileflowURL?: string

		/** FileFlow Export profile name. Used for copying clips into CIFS file shares */
		fileflowProfile?: string
	}
	/** Virtual PackageContainer used for piping data into core */
	export interface CorePackageCollection extends Base {
		type: Accessor.AccessType.CORE_PACKAGE_INFO
		// empty
	}
	export interface AtemMediaStore extends Base {
		type: AccessType.ATEM_MEDIA_STORE
		/** Name/id of the resource, this could for example be the computer name. */
		resourceId?: string
		/** Name/Id of the network the ATEM exists on. Used to differ between different networks. Leave empty if globally accessible. */
		networkId?: string
		/** Ip-address of the Atem */
		atemHost: string
		/** The index of the Atem media/clip banks */
		bankIndex: number
		/** What type of bank */
		mediaType: 'clip' | 'still'
	}
	/** Definition of access to a generic FTP/SFTP endpoint. (Read-access only) */
	export interface FTP extends Base {
		type: AccessType.FTP

		/** The type of FTP server:
		 * - 'ftp': plain ftp
		 * - 'ftps': FTP over TLS (explicit / "AUTH TLS" extension)
		 * - 'ftp'-ssl: FTP over SSL (implicit)
		 * - 'sftp': SFTP over SSH
		 */
		serverType:
			| 'ftp' // plain ftp
			| 'ftps' // FTP over TLS (explicit / "AUTH TLS" extension)
			| 'ftp-ssl' // FTP over SSL (implicit)
			| 'sftp' // SFTP over SSH

		/** Hostname/IP Address to the host server */
		host: string

		/** Port to the host server */
		port?: number

		/** Username to the server */
		username: string

		/** Password to the server */
		password: string

		/** If true, allows any certificates (like self-signed certificates) */
		allowAnyCertificate?: boolean

		/** Path to base folder at the server, (defaults to '/')*/
		basePath?: string

		/** Name/Id of the network the share exists on. Used to differ between different local networks. Leave empty if globally accessible. */
		networkId?: string
	}
}
/**
 * AccessorOnPackage contains interfaces for Accessor definitions that are put ON the Package.
 * The info is then (optionally) combined with the Accessor data
 */
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace AccessorOnPackage {
	export type Any =
		| LocalFolder
		| FileShare
		| HTTP
		| HTTPProxy
		| Quantel
		| CorePackageCollection
		| AtemMediaStore
		| FTP

	export interface LocalFolder extends Partial<Accessor.LocalFolder> {
		/** Path to the file (starting from .folderPath). If not set, the filePath of the ExpectedPackage will be used */
		filePath?: string
	}
	export interface FileShare extends Partial<Accessor.FileShare> {
		/** Path to the file (starting from .folderPath). If not set, the filePath of the ExpectedPackage will be used */
		filePath?: string
	}
	export interface HTTPProxy extends Partial<Accessor.HTTPProxy> {
		/** URL path to resource (combined with .baseUrl gives the full URL), for example: /folder/myFile */
		url?: string
	}
	export interface HTTP extends Partial<Accessor.HTTP> {
		/** URL path to resource (combined with .baseUrl gives the full URL), for example: /folder/myFile */
		url?: string
	}
	export interface Quantel extends Partial<Accessor.Quantel> {
		guid?: string
		title?: string
	}
	// eslint-disable-next-line @typescript-eslint/no-empty-interface
	export interface CorePackageCollection extends Partial<Accessor.CorePackageCollection> {
		// empty
	}
	export interface AtemMediaStore extends Partial<Accessor.AtemMediaStore> {
		filePath?: string
	}
	export interface FTP extends Partial<Accessor.FTP> {
		/** path to resource (combined with .basePath gives the full path), for example: /folder/myFile */
		path?: string
	}
}

export interface PackageContainerOnPackage extends Omit<PackageContainer, 'accessors'> {
	containerId: PackageContainerId
	/** Short name, for displaying to user */
	label: string

	accessors: { [accessorId: AccessorId]: AccessorOnPackage.Any }
}
// Note: Not re-exporting ExpectedPackageStatusAPI in this file, since that is purely a Sofie-Core API
