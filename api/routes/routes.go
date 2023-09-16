package routes

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

func uiRedirect(ctx *gin.Context) {
	ctx.Redirect(301, "/ui/")
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func AddApiRoutes(r *gin.Engine) {
	api := r.Group("/api")
	api.GET("/media", func(ctx *gin.Context) { getPagedMedia(ctx) })
	api.GET("/item/:filehash", func(ctx *gin.Context) { getMediaItem(ctx) })
	api.GET("/stream/:filehash", func(ctx *gin.Context) { streamVideo(ctx) })

	api.GET("/directory", func(ctx *gin.Context) { getDirInfo(ctx) })
	api.POST("/directory", func(ctx *gin.Context) { makeDir(ctx) })

	api.GET("/file", func(ctx *gin.Context) { getFile(ctx) })
	api.DELETE("/file", func(ctx *gin.Context) { moveFileToTrash(ctx) })
	api.PUT("/file", func(ctx *gin.Context) { updateFile(ctx) })

	//api.POST("/item", func(ctx *gin.Context) { uploadItem(ctx) })
	//api.POST("/scan", func(ctx *gin.Context) { scan(ctx) })

	api.GET("/ws", func (ctx *gin.Context) { wsConnect(ctx) })
}

func AddUiRoutes(r *gin.Engine) {
	r.GET("/", func(ctx *gin.Context) { uiRedirect(ctx) })
	r.StaticFS("/ui/", http.Dir("../ui/build"))
}