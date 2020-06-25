# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.0.0] - 2020-06-25
### Changed
- Drop support for Node.js 8

## [3.0.6] - 2020-06-25
### Changed
- Updated dependencies

## [3.0.5] - 2020-04-13
### Fixed
- Multilevel extenders being called multiple times
### Changed
- Updated dependencies

## [3.0.4] - 2020-01-22
### Fixed
- Saving JSON values
### Changed
- Updated dependencies

## [3.0.3] - 2020-01-20
### Changed
- Updated dependencies

## [3.0.2] - 2019-12-24
### Added
- Ability to pass execOpts to linkModels.link
- Updated dependencies

## [3.0.1] - 2019-12-12
### Fixed
- Saving certain data in JSON columns

## [3.0.0] - 2019-12-11
### Changed
- Major refactoring and code quality improvements
- (breaking) No mandatory setup and models auto-loading
### Added
- Better unit and integration tests

## [2.2.3] - 2019-11-06
### Fixed
- Connection client reused when it shouldn't be

## [2.2.2] - 2019-11-04
### Fixed
- Do not try to end the default pool if it's already ended/ending

## [2.2.1] - 2019-11-04
### Changed
- Ignore when model table does not have any columns

## [2.2.0] - 2019-11-02
### Added
- Allow to specify the max connection limit for the default pool

## [2.1.1] - 2019-10-23
### Fixed
- Previous commit

## [2.1.0] - 2019-10-23
### Added
- Ability to reset the default pool

## [2.0.3] - 2019-10-07
### Added
- Model.columnDataTypes

## [2.0.2] - 2019-10-07
### Changed
- Throw when model table does not have any columns

## [2.0.1] - 2019-10-01
### Changed
- Ignore custom "isReferenced" extender

## [2.0.0] - 2019-10-01
### Added
- Changelog
### Changed
- (breaking) Model methods now have query specification decoupled from execution options
- Updated dependencies to the latest versions

## [1.2.3] - 2019-06-14
### Changed
- Allow to nest transactions

## [1.2.2] - 2019-06-04
### Fixed
- Previous commit

## [1.2.1] - 2019-06-04
### Changed
- "isReferenced" extender now uses full table name, including the schema

## [1.2.0] - 2019-05-27
### Added
- "isReferenced" embedded extender
### Changed
- Updated dependencies to the latest versions

## [1.1.2] - 2019-04-24
### Fixed
- Extenders being shared between models

## [1.1.1] - 2019-04-23
### Fixed
- .extend() method of an instance

## [1.1.0] - 2019-04-19
### Added
- Ability to extend nested properties

## [1.0.2] - 2019-04-11
### Fixed
- Unnecessary options being passed to the extender function

## [1.0.1] - 2019-04-09
### Removed
- Unnecessary files from the package

## [1.0.0] - 2019-04-09
Initial release

[Unreleased]: https://github.com/dchekanov/orm/compare/4.0.0...HEAD
[4.0.0]: https://github.com/dchekanov/orm/compare/3.0.6...4.0.0
[3.0.6]: https://github.com/dchekanov/orm/compare/3.0.5...3.0.6
[3.0.5]: https://github.com/dchekanov/orm/compare/3.0.4...3.0.5
[3.0.4]: https://github.com/dchekanov/orm/compare/3.0.3...3.0.4
[3.0.3]: https://github.com/dchekanov/orm/compare/3.0.2...3.0.3
[3.0.2]: https://github.com/dchekanov/orm/compare/3.0.1...3.0.2
[3.0.1]: https://github.com/dchekanov/orm/compare/3.0.0...3.0.1
[3.0.0]: https://github.com/dchekanov/orm/compare/2.2.3...3.0.0
[2.2.3]: https://github.com/dchekanov/orm/compare/2.2.2...2.2.3
[2.2.2]: https://github.com/dchekanov/orm/compare/2.2.1...2.2.2
[2.2.1]: https://github.com/dchekanov/orm/compare/2.2.0...2.2.1
[2.2.0]: https://github.com/dchekanov/orm/compare/2.1.1...2.2.0
[2.1.1]: https://github.com/dchekanov/orm/compare/2.1.0...2.1.1
[2.1.0]: https://github.com/dchekanov/orm/compare/2.0.3...2.1.0
[2.0.3]: https://github.com/dchekanov/orm/compare/2.0.2...2.0.3
[2.0.2]: https://github.com/dchekanov/orm/compare/2.0.1...2.0.2
[2.0.1]: https://github.com/dchekanov/orm/compare/2.0.0...2.0.1
[2.0.0]: https://github.com/dchekanov/orm/compare/1.2.3...2.0.0
[1.2.3]: https://github.com/dchekanov/orm/compare/1.2.2...1.2.3
[1.2.2]: https://github.com/dchekanov/orm/compare/1.2.1...1.2.2
[1.2.1]: https://github.com/dchekanov/orm/compare/1.2.0...1.2.1
[1.2.0]: https://github.com/dchekanov/orm/compare/1.1.2...1.2.0
[1.1.2]: https://github.com/dchekanov/orm/compare/1.1.1...1.1.2
[1.1.1]: https://github.com/dchekanov/orm/compare/1.1.0...1.1.1
[1.1.0]: https://github.com/dchekanov/orm/compare/1.0.2...1.1.0
[1.0.2]: https://github.com/dchekanov/orm/compare/1.0.1...1.0.2
[1.0.1]: https://github.com/dchekanov/orm/compare/1.0.0...1.0.1
[1.0.0]: https://github.com/dchekanov/orm/releases/tag/1.0.0
