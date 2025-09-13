import {IconButton, Tooltip} from '@mui/material';
import {toPng} from 'html-to-image';
import JSZip from 'jszip';
import {saveAs} from 'file-saver';
import {FileDownload} from '@mui/icons-material';
import {useState} from 'react';
import {LoadingButton} from '@mui/lab';

export default function ExportButton({
    className: elementClassName,
    label: buttonLabel,
    pngName: fileName,
    zipName: zipFileName,
    downloadIcon: showDownloadIcon,
    disabled: isDisabled,
    tooltipTitle,
}) {
    const [loading, setLoading] = useState(false);

    const handleExport = async () => {
        let elements = [];
        if (typeof elementClassName === 'string') {
            elements = Array.from(
                document.getElementsByClassName(elementClassName)
            );
            elements = [elements[0]];
        } else {
            elements = elementClassName.map(
                className =>
                    document.getElementsByClassName(className)[0]
            );
        }

        if (elements.length === 1) {
            const dataUrl = await toPng(elements[0], {
                backgroundColor: 'rgba(0, 0, 0, 0)',
                cacheBust: true,
            });

            const link = document.createElement('a');
            link.href = dataUrl;
            link.download = fileName || 'default_name.png';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } else {
            const zip = new JSZip();
            const dataUrlPromises = elements.map(element => {
                return toPng(element, {
                    backgroundColor: 'rgba(0, 0, 0, 0)',
                    cacheBust: true,
                });
            });

            const dataUrls = await Promise.all(dataUrlPromises);

            dataUrls.forEach((dataUrl, idx) => {
                const content = dataUrl.substring(
                    dataUrl.indexOf('base64,') + 'base64,'.length
                );
                zip.file(`${elementClassName[idx]}.png`, content, {
                    base64: true,
                });
            });

            const blob = await zip.generateAsync({type: 'blob'});
            saveAs(blob, zipFileName || 'blueprint-components');
        }
    };

    if (showDownloadIcon) {
        return (
            <Tooltip title={tooltipTitle || 'Download'}>
                <IconButton onClick={handleExport} disabled={isDisabled}>
                    <FileDownload />
                </IconButton>
            </Tooltip>
        );
    }

    return (
        <LoadingButton
            variant="outlined"
            onClick={() => {
                setLoading(true);
                handleExport().finally(() => setLoading(false));
            }}
            style={{
                margin: '8px',
                width: '120px',
            }}
            disabled={isDisabled}
            loading={loading}
        >
            {buttonLabel || (fileName ? 'Export As PNG' : 'Download Blueprint')}
        </LoadingButton>
    );
}