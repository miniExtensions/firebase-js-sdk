"use strict";
/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from) {
    for (var i = 0, il = from.length, j = to.length; i < il; i++, j++)
        to[j] = from[i];
    return to;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var get_github_info_1 = require("@changesets/get-github-info");
var node_fetch_1 = __importDefault(require("node-fetch"));
var changelogFunctions = {
    getDependencyReleaseLine: function (changesets, dependenciesUpdated, options) { return __awaiter(void 0, void 0, void 0, function () {
        var changesetLink, _a, updatedDepenenciesList;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!options.repo) {
                        throw new Error('Please provide a repo to this changelog generator like this:\n"changelog": ["@changesets/changelog-github", { "repo": "org/repo" }]');
                    }
                    if (dependenciesUpdated.length === 0) {
                        return [2 /*return*/, ''];
                    }
                    _a = "- Updated dependencies [";
                    return [4 /*yield*/, Promise.all(changesets.map(function (cs) { return __awaiter(void 0, void 0, void 0, function () {
                            var links;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        if (!cs.commit) return [3 /*break*/, 2];
                                        return [4 /*yield*/, get_github_info_1.getInfo({
                                                repo: options.repo,
                                                commit: cs.commit
                                            })];
                                    case 1:
                                        links = (_a.sent()).links;
                                        return [2 /*return*/, links.commit];
                                    case 2: return [2 /*return*/];
                                }
                            });
                        }); }))];
                case 1:
                    changesetLink = _a + (_b.sent())
                        .filter(function (_) { return _; })
                        .join(', ') + "]:";
                    updatedDepenenciesList = dependenciesUpdated.map(function (dependency) { return "  - " + dependency.name + "@" + dependency.newVersion; });
                    return [2 /*return*/, __spreadArray([changesetLink], updatedDepenenciesList).join('\n')];
            }
        });
    }); },
    getReleaseLine: function (changeset, type, options) { return __awaiter(void 0, void 0, void 0, function () {
        var _a, firstLine, futureLines, _b, pullNumber, links, fixedIssueLink;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    if (!options || !options.repo) {
                        throw new Error('Please provide a repo to this changelog generator like this:\n"changelog": ["@changesets/changelog-github", { "repo": "org/repo" }]');
                    }
                    _a = changeset.summary
                        .split('\n')
                        .map(function (l) { return l.trimRight(); }), firstLine = _a[0], futureLines = _a.slice(1);
                    if (!changeset.commit) return [3 /*break*/, 4];
                    return [4 /*yield*/, get_github_info_1.getInfo({
                            repo: options.repo,
                            commit: changeset.commit
                        })];
                case 1:
                    _b = _c.sent(), pullNumber = _b.pull, links = _b.links;
                    fixedIssueLink = null;
                    if (!(!/issues\/[\d+]/i.test(changeset.summary) && pullNumber)) return [3 /*break*/, 3];
                    return [4 /*yield*/, getFixedIssueLink(pullNumber, options.repo)];
                case 2:
                    fixedIssueLink = _c.sent();
                    _c.label = 3;
                case 3: return [2 /*return*/, "\n\n- " + links.commit + (links.pull === null ? '' : " " + links.pull) + (fixedIssueLink === null ? '' : " " + fixedIssueLink) + " - " + firstLine + "\n" + futureLines.map(function (l) { return "  " + l; }).join('\n')];
                case 4: return [2 /*return*/, "\n\n- " + firstLine + "\n" + futureLines.map(function (l) { return "  " + l; }).join('\n')];
            }
        });
    }); }
};
var fixedIssueRegex = /(close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved) [^\s]*(#|issues\/)([\d]+)/i;
function getFixedIssueLink(prNumber, repo) {
    return __awaiter(this, void 0, void 0, function () {
        var body, match, issueNumber;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, node_fetch_1.default("https://api.github.com/repos/" + repo + "/pulls/" + prNumber, {
                        method: 'GET',
                        headers: {
                            'Authorization': "Bearer " + process.env.GITHUB_TOKEN
                        }
                    }).then(function (data) { return data.json(); })];
                case 1:
                    body = (_a.sent()).body;
                    match = fixedIssueRegex.exec(body);
                    if (!match) {
                        return [2 /*return*/, ''];
                    }
                    issueNumber = match[3];
                    return [2 /*return*/, "(fixes [#" + issueNumber + "](https://github.com/firebase/firebase-js-sdk/issues/" + issueNumber + "))"];
            }
        });
    });
}
exports.default = changelogFunctions;
