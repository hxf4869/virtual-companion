// Run once inside the backend module's build image. Input comes only from
// private environment files. Channels remain disabled and no sender runs.
package main

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

func stop(stage string) {
	fmt.Fprintln(os.Stderr, "configuration import failed:", stage)
	os.Exit(1)
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	owner, err := strconv.ParseInt(os.Getenv("OWNER_ACCOUNT_ID"), 10, 64)
	if err != nil || owner <= 0 {
		stop("owner")
	}
	store, err := postgres.Open(ctx, postgres.OpenConfig{
		DSN: os.Getenv("VC_DB_DSN"), OwnerBindingSecret: os.Getenv("VC_OWNER_BINDING_SECRET"),
	})
	if err != nil {
		stop("database")
	}
	defer store.Close()
	cipher, err := postgres.NewDefaultFieldCipher(os.Getenv("VC_CRYPTO_REST_KEY"))
	if err != nil {
		stop("cipher")
	}
	store.UseCipher(cipher)
	inputs := []postgres.NotificationChannelInput{
		{Channel: "EMAIL", ConfiguredTarget: os.Getenv("OWNER_EMAIL_RECIPIENT"),
			CredentialPlain: os.Getenv("OWNER_EMAIL_SMTP_USERNAME") + "\n" + os.Getenv("OWNER_EMAIL_SMTP_APP_PASSWORD")},
		{Channel: "FEISHU", ConfiguredTarget: os.Getenv("OWNER_FEISHU_GROUP"),
			CredentialPlain: os.Getenv("OWNER_FEISHU_WEBHOOK_URL") + "\n" + os.Getenv("OWNER_FEISHU_SIGN_SECRET")},
	}
	for _, input := range inputs {
		input.Enabled = false
		input.PreviewBody = false
		input.RelationshipIDs = []int64{}
		input.CredentialMode = "set"
		row, err := store.PutNotificationChannel(ctx, owner, input)
		if err != nil || row.Enabled || row.PreviewBody {
			stop("disabled_channel")
		}
	}
	fmt.Println("notification configuration imported: channels=2 enabled=0 preview=0 sent=0")
}
