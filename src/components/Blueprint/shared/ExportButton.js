"use strict";
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
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = ExportButton;
var material_1 = require("@mui/material");
var html_to_image_1 = require("html-to-image");
var jszip_1 = require("jszip");
var file_saver_1 = require("file-saver");
var icons_material_1 = require("@mui/icons-material");
var react_1 = require("react");
var lab_1 = require("@mui/lab");
function ExportButton(_a) {
    var _this = this;
    var elementClassName = _a.className, buttonLabel = _a.label, fileName = _a.pngName, zipFileName = _a.zipName, showDownloadIcon = _a.downloadIcon, isDisabled = _a.disabled, tooltipTitle = _a.tooltipTitle;
    var _b = (0, react_1.useState)(false), loading = _b[0], setLoading = _b[1];
    var handleExport = function () { return __awaiter(_this, void 0, void 0, function () {
        var elements, dataUrl, link, zip_1, dataUrlPromises, dataUrls, blob;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    elements = [];
                    if (typeof elementClassName === 'string') {
                        elements = Array.from(document.getElementsByClassName(elementClassName));
                        elements = [elements[0]];
                    }
                    else {
                        elements = elementClassName.map(function (className) {
                            return document.getElementsByClassName(className)[0];
                        });
                    }
                    if (!(elements.length === 1)) return [3 /*break*/, 2];
                    return [4 /*yield*/, (0, html_to_image_1.toPng)(elements[0], {
                            backgroundColor: 'rgba(0, 0, 0, 0)',
                            cacheBust: true,
                        })];
                case 1:
                    dataUrl = _a.sent();
                    link = document.createElement('a');
                    link.href = dataUrl;
                    link.download = fileName || 'default_name.png';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    return [3 /*break*/, 5];
                case 2:
                    zip_1 = new jszip_1.default();
                    dataUrlPromises = elements.map(function (element) {
                        return (0, html_to_image_1.toPng)(element, {
                            backgroundColor: 'rgba(0, 0, 0, 0)',
                            cacheBust: true,
                        });
                    });
                    return [4 /*yield*/, Promise.all(dataUrlPromises)];
                case 3:
                    dataUrls = _a.sent();
                    dataUrls.forEach(function (dataUrl, idx) {
                        var content = dataUrl.substring(dataUrl.indexOf('base64,') + 'base64,'.length);
                        zip_1.file("".concat(elementClassName[idx], ".png"), content, {
                            base64: true,
                        });
                    });
                    return [4 /*yield*/, zip_1.generateAsync({ type: 'blob' })];
                case 4:
                    blob = _a.sent();
                    (0, file_saver_1.saveAs)(blob, zipFileName || 'blueprint-components');
                    _a.label = 5;
                case 5: return [2 /*return*/];
            }
        });
    }); };
    if (showDownloadIcon) {
        return (<material_1.Tooltip title={tooltipTitle || 'Download'}>
                <material_1.IconButton onClick={handleExport} disabled={isDisabled}>
                    <icons_material_1.FileDownload />
                </material_1.IconButton>
            </material_1.Tooltip>);
    }
    return (<lab_1.LoadingButton variant="outlined" onClick={function () {
            setLoading(true);
            handleExport().finally(function () { return setLoading(false); });
        }} style={{
            margin: '8px',
            width: '120px',
        }} disabled={isDisabled} loading={loading}>
            {buttonLabel || (fileName ? 'Export As PNG' : 'Download Blueprint')}
        </lab_1.LoadingButton>);
}
