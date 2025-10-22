# Sofie Package Manager

This is the _Package Manager_ application of the [**Sofie** TV News Studio Automation System](https://github.com/Sofie-Automation/Sofie-TV-automation/).

- [_For Developers_](DEVELOPER.md)

## General Sofie System Information

- [_Sofie_ Documentation](https://sofie-automation.github.io/sofie-core/)
- [_Sofie_ Releases](https://sofie-automation.github.io/sofie-core/releases)
- [Contribution Guidelines](CONTRIBUTING.md)
- [License](LICENSE)

---

## Introduction

In generic terms (which are the best terms) the Package Manager performs _Operations_ on _Packages_ at various _locations_.

In simpler terms (which makes more sense), the Package Manager can _Copy_ _Files_ across various _file systems (such as local folders, network shares, ftp etc)_, or perform other operations such as _Transcoding_ or _Creating Thumbnails_.

The Package Manager also reports the status of all _Operations_ and monitors the results. For example, if a file is to be copied onto a location, the Package Manager will report whether the file is in place or not.

In addition, the Package Manager supports _versioning_ of Packages (eg it'll copy a new file if it has changed), _chaining of operations_ (eg copy a file, then transcode it, then create a thumbnail).

The input to Package Manager is a list of _Expected Packages_ which defines the target state of the Packages (ie which Packages (files) should be present on which locations). Internally, the Package Manager uses a restful API, which allows for distributed operations with Workers running on multiple different platforms with different capabilities, sharing the load.

### Supported operations

- Copy File
- Copy Proxy file from Quantel (using Quantel transformer)
- Verify a File exists (ie no operation, just a check)
- Copy JSON-data into Sofie data store
- Make a preview of a media file (using ffmpeg)
- Make a thumbnail of a media file (using ffmpeg)
- Scan a media file (using ffprobe)
- "Deep scan" a media file (detect black frames, freeze frames, scenes) (using ffmpeg)
- Scan media file to detect type of iframes (using ffmpeg)
- Copy Quantel Clip (between Quantel servers only)
- Create preview file from Quantel Clip (using Quantel transformer)
- Create thumbnail from Quantel Clip (using Quantel transformer)
- Render HTML to video file

### Supported endpoints

- Local files
- Network shares
- Atem media pool
- Sofie data store (PackageInfo)
- Generic HTTP (read only)
- HTTP Proxy Server (read & upload)
- FTP
- Quantel server

## Quick Start

See the [Installing Package Manager](https://sofie-automation.github.io/sofie-core/docs/user-guide/installation/installing-package-manager) page of the [Sofie System Documentation](https://sofie-automation.github.io/sofie-core/) to learn how to get started with Package Manager in a demo environment with CasparCG.

## File Structure

This is a monorepo, all packages resides in [shared/packages](shared/packages) and [apps/](apps/).

The packages in [shared/packages](shared/packages) are helper libraries, used by the packages in [apps/](apps/).

The packages in [apps/](apps/) can be run as individual applications.

The packages in [tests/](tests/) contain unit/integration tests.

### Applications

| Name                  | Location                                                 | Description                                                                                                                                                                                                                  |
| --------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workforce**         | [apps/workforce/app](apps/workforce/app)                 | Mediates connections between the Workers and the Package Managers. _(Later: Will handle spin-up/down of workers according to the current need.)_                                                                             |
| **Package Manager**   | [apps/package-manager/app](apps/package-manager/app)     | The Package Manager receives `expectedPackages` from a [Sofie Core](https://github.com/Sofie-Automation/sofie-core), converts them into `Expectations`. Keeps track of work statues and distributes the work to the Workers. |
| **Worker**            | [apps/worker/app](apps/worker/app)                       | Executes work orders from the Package Manager                                                                                                                                                                                |
| **AppContainer-node** | [apps/appcontainer-node/app](apps/appcontainer-node/app) | Spins up/down workers according to the current need. (This appContainer uses child processes, future ones could work with for example Kubernetes or AWS)                                                                     |
| **HTTP-server**       | [apps/http-server/app](apps/http-server/app)             | A simple HTTP server, where files can be uploaded to and served from. (Often used for thumbnails & previews)                                                                                                                 |
| **Single-app**        | [apps/single-app/app](apps/single-app/app)               | Runs one of each of the above in a single application.                                                                                                                                                                       |

### Packages (Libraries)

| Name                   | Location                                                                 | Description                                                             |
| ---------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| **API**                | [shared/packages/api](shared/packages/api)                               | Various interfaces used by the other libraries                          |
| **ExpectationManager** | [shared/packages/expectationManager](shared/packages/expectationManager) | The ExpectationManager class is used by the Package Manager application |
| **Worker**             | [shared/packages/worker](shared/packages/worker)                         | The Worker class is used by the Worker application                      |
| **Workforce**          | [shared/packages/Workforce](shared/packages/Workforce)                   | The Workforce class is used by the Worker application                   |

## Notes on Installation

It has been observed a potential issue when running Package Manager as an executable on Windows:
For unknown reasons, there is a buildup of "zombie" TCP sockets over time. It is unknown if this is caused by something in Package Manager or ffmpeg/ffprobe.
As a remedy/hack, [this script](/scripts/clean-up-tcp-sockets.bat) has been useful to avoid potential longterm issues.

---

_The NRK logo is a registered trademark of Norsk rikskringkasting AS. The license does not grant any right to use, in any way, any trademarks, service marks or logos of Norsk rikskringkasting AS._
