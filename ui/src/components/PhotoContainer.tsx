import { useState, useEffect, useRef, useMemo, ComponentProps } from "react";
import { Blurhash } from "react-blurhash";
import API_ENDPOINT from '../api/ApiEndpoint'

import Box from '@mui/material/Box';
import { CircularProgress } from '@mui/material'
import styled from "@emotion/styled";

// Styles

const ThumbnailContainer = styled(Box)({
    top: 0,
    left: 0,
    height: "100%",
    width: "100%",
    display: "flex",
    position: "absolute",
    justifyContent: "center",
    overflow: "hidden",
    objectFit: "contain"
})

const StyledLoader = styled(CircularProgress)({
    position: "absolute",
    zIndex: 1,
    bottom: "10px",
    right: "10px",
    color: "rgb(255, 255, 255)"
})

//Components


export function useIsVisible(ref) {
    const [isIntersecting, setIntersecting] = useState(false);

    useEffect(() => {
        let options = {
            rootMargin: "1000px"
        }
        const observer = new IntersectionObserver(([entry]) => {
            setIntersecting(entry.isIntersecting)
        }, options)

        observer.observe(ref.current);
        return () => {
            observer.disconnect();
        };
    }, [ref]);

    return isIntersecting;
}


export const MediaImage = ({
    mediaData,
    quality,
    lazy,
    ...props
}) => {
    const [imageLoaded, setImageLoaded] = useState(false)
    const ref = useRef()
    const isVisible = useIsVisible(ref)

    const imgUrl = new URL(`${API_ENDPOINT}/item/${mediaData.FileHash}`)
    imgUrl.searchParams.append(quality, "true")

    return (
        <ThumbnailContainer ref={ref} >
            {!imageLoaded && (
                <StyledLoader size={20} />
            )}

            <img
                height={"100%"}
                width={"100%"}
                loading={lazy ? "lazy" : "eager"}

                {...props}

                src={imgUrl.toString()}
                style={{ position: "absolute", display: isVisible ? "block" : "none" }}

                onLoad={() => { setImageLoaded(true) }}
            />
            {mediaData.BlurHash && lazy && !imageLoaded && (
                <Blurhash
                    style={{ position: "absolute" }}
                    height={250}
                    width={550}
                    hash={mediaData.BlurHash}
                />

            )}
        </ThumbnailContainer>
    )
}