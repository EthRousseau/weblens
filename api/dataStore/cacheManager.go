package dataStore

import (
	"context"
	"fmt"
	"time"

	"github.com/creativecreature/sturdyc"
	"github.com/ethrousseau/weblens/api/types"
)

var thumbnailCache = sturdyc.New[[]byte](500, 10, time.Hour, 10)

func getMediaCache(m types.Media, q types.Quality, pageNum int) ([]byte, error) {
	cacheKey := string(m.Id()) + string(q)

	ctx := context.Background()
	ctx = context.WithValue(ctx, "cacheKey", cacheKey)
	ctx = context.WithValue(ctx, "quality", q)
	ctx = context.WithValue(ctx, "pageNum", pageNum)
	ctx = context.WithValue(ctx, "media", m)
	return thumbnailCache.GetFetch(ctx, cacheKey, memCacheMediaImage)
}

func memCacheMediaImage(ctx context.Context) (data []byte, err error) {
	m := ctx.Value("media").(*media)
	q := ctx.Value("quality").(types.Quality)
	pageNum := ctx.Value("pageNum").(int)

	f, err := m.getCacheFile(q, true, pageNum)
	if err != nil {
		return
	} else if f == nil {
		return nil, ErrNoFile
	}

	data, err = f.ReadAll()
	if err != nil {
		return
	}
	if len(data) == 0 {
		err = fmt.Errorf("displayable bytes empty")
		return
	}

	return

}
